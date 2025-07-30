/*
Copyright 2025 The Kubernetes Authors.

Licensed under the Apache License, Version 2.0 (the "License");
you may not use this file except in compliance with the License.
You may obtain a copy of the License at

    http://www.apache.org/licenses/LICENSE-2.0

Unless required by applicable law or agreed to in writing, software
distributed under the License is distributed on an "AS IS" BASIS,
WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
See the License for the specific language governing permissions and
limitations under the License.
*/

package portforward

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"net"
	"net/http"
	"net/url"
	"strconv"
	"syscall"
	"time"

	"github.com/google/uuid"
	"github.com/gorilla/mux"
	"github.com/kubernetes-sigs/headlamp/backend/pkg/auth"
	"github.com/kubernetes-sigs/headlamp/backend/pkg/cache"
	"github.com/kubernetes-sigs/headlamp/backend/pkg/kubeconfig"
	"github.com/kubernetes-sigs/headlamp/backend/pkg/logger"
	authv1 "k8s.io/api/authorization/v1"
	corev1 "k8s.io/api/core/v1"
	v1 "k8s.io/apimachinery/pkg/apis/meta/v1"
	"k8s.io/client-go/kubernetes"
	"k8s.io/client-go/rest"
	"k8s.io/client-go/tools/portforward"
	"k8s.io/client-go/transport/spdy"
)

const (
	RUNNING = "Running"
	STOPPED = "Stopped"
)

const (
	PodAvailabilityCheckTimer   = 5 // seconds
	PortForwardReadinessTimeout = 30 * time.Second
)

type portForwardRequest struct {
	ID               string `json:"id"`
	Namespace        string `json:"namespace"`
	Pod              string `json:"pod"`
	Service          string `json:"service"`
	ServiceNamespace string `json:"serviceNamespace"`
	TargetPort       string `json:"targetPort"`
	Port             string `json:"port"`
}

func (p *portForwardRequest) Validate() error {
	if p.Namespace == "" {
		return fmt.Errorf("namespace is required")
	}

	if p.Pod == "" {
		return fmt.Errorf("pod name is required")
	}

	if p.TargetPort == "" {
		return fmt.Errorf("targetPort is required")
	}

	return nil
}

type portForward struct {
	ID               string `json:"id"`
	closeChan        chan struct{}
	Pod              string `json:"pod"`
	Service          string `json:"service"`
	ServiceNamespace string `json:"serviceNamespace"`
	Namespace        string `json:"namespace"`
	Cluster          string `json:"cluster"`
	Port             string `json:"port"`
	TargetPort       string `json:"targetPort"`
	Status           string `json:"status"`
	Error            string `json:"error"`
}

func getFreePort() (int, error) {
	addr, err := net.ResolveTCPAddr("tcp", "localhost:0")
	if err != nil {
		return 0, err
	}

	l, err := net.ListenTCP("tcp", addr)
	if err != nil {
		return 0, err
	}

	defer l.Close()

	return l.Addr().(*net.TCPAddr).Port, nil
}

// StartPortForward handles the port forward request.
//
//nolint:funlen
func StartPortForward(kubeConfigStore kubeconfig.ContextStore, cache cache.Cache[interface{}],
	w http.ResponseWriter, r *http.Request,
) {
	var p portForwardRequest

	if err := json.NewDecoder(r.Body).Decode(&p); err != nil {
		logger.Log(logger.LevelError, nil, err, "decoding portforward payload")
		http.Error(w, "failed to marshal port forward payload "+err.Error(), http.StatusBadRequest)

		return
	}

	if p.ID == "" {
		p.ID = uuid.New().String()
	}

	if err := p.Validate(); err != nil {
		logger.Log(logger.LevelError, nil, err, "validating portforward payload")
		http.Error(w, err.Error(), http.StatusBadRequest)

		return
	}

	if p.Port == "" {
		freePort, err := getFreePort()
		if err != nil || freePort == 0 {
			logger.Log(logger.LevelError, nil, err, "getting free port")
			http.Error(w, "can't find any available port "+err.Error(), http.StatusInternalServerError)

			return
		}

		p.Port = strconv.Itoa(freePort)
	}

	token, _ := auth.GetTokenFromCookie(r, mux.Vars(r)["clusterName"])

	userID := r.Header.Get("X-HEADLAMP-USER-ID")
	clusterName := mux.Vars(r)["clusterName"]

	if userID != "" {
		clusterName += userID
	}

	kContext, err := kubeConfigStore.GetContext(clusterName)
	if err != nil {
		logger.Log(logger.LevelError, map[string]string{"cluster": clusterName},
			err, "getting kubeconfig context")
		http.Error(w, err.Error(), http.StatusInternalServerError)

		return
	}

	err = startPortForward(kContext, cache, p, token, clusterName)
	if err != nil {
		logger.Log(logger.LevelError, nil, err, "starting portforward")
		http.Error(w, err.Error(), http.StatusInternalServerError)

		return
	}

	w.Header().Set("Content-Type", "application/json")

	if err = json.NewEncoder(w).Encode(p); err != nil {
		logger.Log(logger.LevelError, nil, err, "writing json payload to response write")
		http.Error(w, "failed to write json payload to response write "+err.Error(), http.StatusInternalServerError)

		return
	}
}

// checkPortForwardPermission checks if the current user has permission to create pods/portforward.
// It uses SelfSubjectAccessReview to verify RBAC permissions for the specified namespace and pod.
// Returns an error if permission is denied or if the permission check fails.
func checkPortForwardPermission(clientset *kubernetes.Clientset, namespace, podName string) error {
	ctx := context.Background()

	// Create a SelfSubjectAccessReview to check permissions
	ssar := &authv1.SelfSubjectAccessReview{
		Spec: authv1.SelfSubjectAccessReviewSpec{
			ResourceAttributes: &authv1.ResourceAttributes{
				Namespace:   namespace,
				Verb:        "create",
				Group:       "", // core API group
				Resource:    "pods",
				Subresource: "portforward",
				Name:        podName,
			},
		},
	}

	result, err := clientset.AuthorizationV1().SelfSubjectAccessReviews().Create(ctx, ssar, v1.CreateOptions{})
	if err != nil {
		return fmt.Errorf("failed to check permissions: %w", err)
	}

	if !result.Status.Allowed {
		reason := "insufficient permissions"
		if result.Status.Reason != "" {
			reason = result.Status.Reason
		}

		return fmt.Errorf("access denied: %s", reason)
	}

	return nil
}

// getKubeClientAndConfig prepares Kubernetes clientset and REST config.
// It takes a kubeconfig context and an optional bearer token.
// It returns the configured clientset, REST config, or an error if setup fails.
func getKubeClientAndConfig(kContext *kubeconfig.Context, token string) (*kubernetes.Clientset, *rest.Config, error) {
	clientset, err := kContext.ClientSetWithToken(token)
	if err != nil {
		return nil, nil, fmt.Errorf("failed to create clientset: %w", err)
	}

	rConf, err := kContext.RESTConfig()
	if err != nil {
		return nil, nil, fmt.Errorf("failed to get REST config: %w", err)
	}

	if token != "" {
		rConf.BearerToken = token
	}

	return clientset, rConf, nil
}

// initPortForwarder sets up the SPDY dialer and creates a new port forwarder.
// It requires a REST config, namespace, pod name, and the port mapping string (e.g., "8080:80").
// It returns the port forwarder instance, stop/ready channels, output/error buffers, or an error.
func initPortForwarder(rConf *rest.Config, namespace, podName, portMapping string) (
	*portforward.PortForwarder, chan struct{}, chan struct{}, *bytes.Buffer, *bytes.Buffer, error,
) {
	roundTripper, upgrader, err := spdy.RoundTripperFor(rConf)
	if err != nil {
		return nil, nil, nil, nil, nil, fmt.Errorf("failed to create SPDY round tripper: %w", err)
	}

	path := fmt.Sprintf("/api/v1/namespaces/%s/pods/%s/portforward", namespace, podName)

	hostURL, err := url.Parse(rConf.Host)
	if err != nil {
		return nil, nil, nil, nil, nil, fmt.Errorf("invalid REST config host: %w", err)
	}

	fullURL := hostURL.ResolveReference(&url.URL{Path: path})

	dialer := spdy.NewDialer(upgrader, &http.Client{Transport: roundTripper}, http.MethodPost, fullURL)
	stopChan, readyChan := make(chan struct{}), make(chan struct{}, 1)
	out, errOut := new(bytes.Buffer), new(bytes.Buffer)

	forwarder, err := portforward.New(dialer, []string{portMapping}, stopChan, readyChan, out, errOut)
	if err != nil {
		return nil, nil, nil, nil, nil, fmt.Errorf("failed to create portforwarder: %w", err)
	}

	return forwarder, stopChan, readyChan, out, errOut, nil
}

// safeCloseChan attempts to close a channel and recovers from a panic
// if the channel is already closed or nil.
func safeCloseChan(ch chan struct{}) {
	defer func() {
		if r := recover(); r != nil {
			_ = r
		}
	}()

	if ch != nil {
		close(ch)
	}
}

// monitorPodAndManagePortForward runs in a goroutine and periodically checks if the
// target pod for a port-forward is still running. If the pod is not running
// (or if an unrecoverable error occurs during check), it signals the port-forward
// to stop by closing its stopChan and updates its status in the cache.
// It stops when the associated port-forward's closeChan is closed.
func monitorPodAndManagePortForward(
	clientset *kubernetes.Clientset,
	cache cache.Cache[interface{}],
	pfDetails *portForward,
) {
	ticker := time.NewTicker(PodAvailabilityCheckTimer * time.Second)
	defer ticker.Stop()

	logParams := map[string]string{"id": pfDetails.ID, "pod": pfDetails.Pod, "namespace": pfDetails.Namespace}

	for {
		select {
		case <-ticker.C:
			err := checkIfPodIsRunning(clientset, pfDetails.Namespace, pfDetails.Pod)
			if err != nil {
				if errors.Is(err, syscall.ECONNREFUSED) {
					logger.Log(logger.LevelInfo, logParams, err, "checking pod (ECONNREFUSED), continuing")
					continue
				}

				errMsg := fmt.Sprintf("Pod %s/%s check failed: %v", pfDetails.Namespace, pfDetails.Pod, err)
				logger.Log(logger.LevelError, logParams, errors.New(errMsg), "stopping port-forward due to pod status")

				pfDetails.Status = STOPPED
				pfDetails.Error = errMsg
				portforwardstore(cache, *pfDetails)
				safeCloseChan(pfDetails.closeChan)

				return
			}
		case <-pfDetails.closeChan:
			logger.Log(logger.LevelInfo, logParams, nil, "Pod monitor stopping: port forward closeChan was closed.")

			return
		}
	}
}

func handlePortForwardError(
	cache cache.Cache[interface{}],
	pfDetails *portForward,
	logParams map[string]string,
	errMsg string,
	isReady bool,
) error {
	logger.Log(logger.LevelError, logParams, errors.New(errMsg), "portforward error")

	pfDetails.Status = STOPPED
	pfDetails.Error = errMsg

	portforwardstore(cache, *pfDetails)
	safeCloseChan(pfDetails.closeChan)

	if isReady {
		return nil
	}

	return errors.New(errMsg)
}

// Helper to handle success and update state.
func handlePortForwardSuccess(
	cache cache.Cache[interface{}],
	pfDetails *portForward,
	logParams map[string]string,
) {
	pfDetails.Status = RUNNING
	pfDetails.Error = ""
	portforwardstore(cache, *pfDetails)
	logger.Log(logger.LevelInfo, logParams, nil, "Port forward ready and running.")
}

// handlePortForwardReadiness waits for the port forward to be ready, handling potential
// errors from errOut, timeouts, or premature stop signals.
// It updates the portForward details in the cache based on the outcome.
func handlePortForwardReadiness(
	cache cache.Cache[interface{}],
	pfDetails *portForward,
	readyChan chan struct{},
	errOut *bytes.Buffer,
	logParams map[string]string,
	forwardErrChan <-chan error,
) error {
	select {
	case <-readyChan:
		if errOut.String() != "" {
			return handlePortForwardError(cache, pfDetails, logParams,
				fmt.Sprintf("portforward failed to start, stderr: %s", errOut.String()), false)
		}

		handlePortForwardSuccess(cache, pfDetails, logParams)
	case err := <-forwardErrChan:
		return handlePortForwardError(cache, pfDetails, logParams, err.Error(), false)
	case <-time.After(PortForwardReadinessTimeout):
		return handlePortForwardError(cache, pfDetails, logParams, "timeout waiting for portforward to become ready", false)
	case <-pfDetails.closeChan:
		msg := "portforward stopped before becoming ready"

		if pfDetails.Status == RUNNING {
			pfDetails.Status = STOPPED
		}

		if pfDetails.Error == "" {
			pfDetails.Error = msg
		}

		portforwardstore(cache, *pfDetails)
		logger.Log(logger.LevelInfo, logParams, nil, msg)

		return errors.New(msg)
	}

	return nil
}

// runAndMonitorPortForward starts the actual port forwarding in a goroutine,
// then handles its readiness, and if ready, starts another goroutine to
// monitor the target pod's status.
func runAndMonitorPortForward(
	clientset *kubernetes.Clientset,
	cache cache.Cache[interface{}],
	pfDetails *portForward,
	forwarder *portforward.PortForwarder,
	readyChan chan struct{},
	errOut *bytes.Buffer,
) error {
	logParams := map[string]string{
		"id": pfDetails.ID, "pod": pfDetails.Pod, "port": pfDetails.Port, "targetPort": pfDetails.TargetPort,
	}
	forwardErrChan := make(chan error, 1)

	go func() {
		if err := forwarder.ForwardPorts(); err != nil {
			logger.Log(logger.LevelError, logParams, err, "ForwardPorts() failed")

			pfDetails.Status = STOPPED
			pfDetails.Error = err.Error()

			portforwardstore(cache, *pfDetails)
			select {
			case forwardErrChan <- err:
			default:
			}
			safeCloseChan(pfDetails.closeChan)
		} else {
			logger.Log(logger.LevelInfo, logParams, nil, "ForwardPorts() exited.")

			if pfDetails.Status == RUNNING {
				pfDetails.Status = STOPPED
				if pfDetails.Error == "" {
					pfDetails.Error = "Port forward stopped."
				}

				portforwardstore(cache, *pfDetails)
			}
		}

		close(forwardErrChan)
	}()

	err := handlePortForwardReadiness(cache, pfDetails, readyChan, errOut, logParams, forwardErrChan)
	if err != nil {
		return err
	}

	go monitorPodAndManagePortForward(clientset, cache, pfDetails)

	return nil
}

// startPortForward starts a port forward. This is the internal function that was refactored.
// It sets up Kubernetes clients, initializes the port forwarder, and manages its lifecycle.
func startPortForward(kContext *kubeconfig.Context, cache cache.Cache[interface{}],
	p portForwardRequest, token string, clusterName string,
) error {
	clientset, rConf, err := getKubeClientAndConfig(kContext, token)
	if err != nil {
		return fmt.Errorf("failed to setup Kubernetes client/config: %w", err)
	}

	// Check RBAC permissions before attempting port forward
	err = checkPortForwardPermission(clientset, p.Namespace, p.Pod)
	if err != nil {
		return fmt.Errorf("permission check failed: %w", err)
	}

	portMapping := p.Port + ":" + p.TargetPort

	var (
		forwarder           *portforward.PortForwarder
		stopChan, readyChan chan struct{}
		outBuffer, errOut   *bytes.Buffer
		errInit             error
	)

	forwarder, stopChan, readyChan, outBuffer, errOut, errInit = initPortForwarder(
		rConf, p.Namespace, p.Pod, portMapping,
	)
	if errInit != nil {
		return fmt.Errorf("failed to initialize port forwarder: %w", errInit)
	}

	_ = outBuffer // Avoid unused variable error if outBuffer isn't used directly later

	pfDetails := &portForward{
		ID:               p.ID,
		closeChan:        stopChan,
		Pod:              p.Pod,
		Cluster:          clusterName,
		Namespace:        p.Namespace,
		Service:          p.Service,
		ServiceNamespace: p.ServiceNamespace,
		TargetPort:       p.TargetPort,
		Status:           RUNNING,
		Port:             p.Port,
		Error:            "",
	}

	return runAndMonitorPortForward(clientset, cache, pfDetails, forwarder, readyChan, errOut)
}

func checkIfPodIsRunning(clientset *kubernetes.Clientset, namespace string, pod string) error {
	ctx := context.Background()

	p, err := clientset.CoreV1().Pods(namespace).Get(ctx, pod, v1.GetOptions{})
	if err != nil {
		return err
	}

	if p.Status.Phase != corev1.PodRunning {
		return errors.New("pod is not running")
	}

	return nil
}

// stopOrDeletePortForwardRequest is the payload for stop or delete port forward request handler.
type stopOrDeletePortForwardRequest struct {
	ID           string `json:"id"`
	StopOrDelete bool   `json:"stopOrDelete"`
}

func (r *stopOrDeletePortForwardRequest) Validate() error {
	if r.ID == "" {
		return errors.New("invalid request, id is required")
	}

	return nil
}

// StopOrDeletePortForward handles stop or delete port forward request.
func StopOrDeletePortForward(cache cache.Cache[interface{}], w http.ResponseWriter, r *http.Request) {
	var p stopOrDeletePortForwardRequest

	err := json.NewDecoder(r.Body).Decode(&p)
	if err != nil {
		logger.Log(logger.LevelError, nil, err, "decoding delete portforward payload")
		http.Error(w, err.Error(), http.StatusBadRequest)

		return
	}

	if err := p.Validate(); err != nil {
		logger.Log(logger.LevelError, nil, err, "validating delete portforward payload")
		http.Error(w, err.Error(), http.StatusBadRequest)

		return
	}

	userID := r.Header.Get("X-HEADLAMP-USER-ID")
	clusterName := mux.Vars(r)["clusterName"]

	if userID != "" {
		clusterName += userID
	}

	err = stopOrDeletePortForward(cache, clusterName, p.ID, p.StopOrDelete)
	if err == nil {
		if _, err := w.Write([]byte("stopped")); err != nil {
			logger.Log(logger.LevelError, nil, err, "writing response")
			http.Error(w, "failed to write response "+err.Error(), http.StatusInternalServerError)
		}

		return
	}

	http.Error(w, "failed to delete port forward "+err.Error(), http.StatusInternalServerError)
}

// GetPortForwards handles get port forwards request.
func GetPortForwards(cache cache.Cache[interface{}], w http.ResponseWriter, r *http.Request) {
	cluster := mux.Vars(r)["clusterName"]
	if cluster == "" {
		logger.Log(logger.LevelError, nil, errors.New("cluster is required"), "getting portforwards")
		http.Error(w, "cluster is required", http.StatusBadRequest)

		return
	}

	userID := r.Header.Get("X-HEADLAMP-USER-ID")
	clusterName := cluster

	if userID != "" {
		clusterName = cluster + userID
	}

	ports := getPortForwardList(cache, clusterName)

	w.Header().Set("Content-Type", "application/json")

	if err := json.NewEncoder(w).Encode(ports); err != nil {
		logger.Log(logger.LevelError, nil, err, "writing json payload to response")
		http.Error(w, "failed to write json payload to response "+err.Error(), http.StatusInternalServerError)

		return
	}
}

// GetPortForwardByID handles get port forward by id request.
func GetPortForwardByID(cache cache.Cache[interface{}], w http.ResponseWriter, r *http.Request) {
	cluster := mux.Vars(r)["clusterName"]
	if cluster == "" {
		logger.Log(logger.LevelError, nil, errors.New("cluster is required"), "getting portforward by id")
		http.Error(w, "cluster is required", http.StatusBadRequest)

		return
	}

	id := r.URL.Query().Get("id")
	if id == "" {
		logger.Log(logger.LevelError, nil, errors.New("id is required"), "getting portforward by id")
		http.Error(w, "id is required", http.StatusBadRequest)

		return
	}

	userID := r.Header.Get("X-HEADLAMP-USER-ID")
	clusterName := cluster

	if userID != "" {
		clusterName = cluster + userID
	}

	p, err := getPortForwardByID(cache, clusterName, id)
	if err != nil {
		logger.Log(logger.LevelError, nil, err, "getting portforward by id")
		http.Error(w, "no portforward running with id "+id, http.StatusNotFound)

		return
	}

	type payload struct {
		ID        string `json:"id"`
		Pod       string `json:"pod"`
		Service   string `json:"service"`
		Cluster   string `json:"cluster"`
		Namespace string `json:"namespace"`
	}

	portForwardStruct := payload{
		ID:        p.ID,
		Pod:       p.Pod,
		Namespace: p.Namespace,
		Cluster:   p.Cluster,
		Service:   p.Service,
	}

	w.Header().Set("Content-Type", "application/json")

	if err := json.NewEncoder(w).Encode(portForwardStruct); err != nil {
		logger.Log(logger.LevelError, nil, err, "writing json payload to response")
		http.Error(w, "failed to write json payload "+err.Error(), http.StatusInternalServerError)

		return
	}
}

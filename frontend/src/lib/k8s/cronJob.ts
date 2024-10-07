import { apiFactoryWithNamespace } from './apiProxy';
import { KubeContainer } from './cluster';
import { KubeMetadata } from './KubeMetadata';
import { KubeObject, KubeObjectInterface } from './KubeObject';

/**
 * CronJob structure returned by the k8s API.
 *
 * @see {@link https://kubernetes.io/docs/reference/kubernetes-api/workload-resources/cron-job-v1/} Kubernetes API reference for CronJob
 *
 * @see {@link https://kubernetes.io/docs/concepts/workloads/controllers/cron-jobs/} Kubernetes definition for CronJob
 */
export interface KubeCronJob extends KubeObjectInterface {
  spec: {
    suspend: boolean;
    schedule: string;
    startingDeadlineSeconds?: number;
    successfulJobsHistoryLimit: number;
    failedJobsHistoryLimit: number;
    concurrencyPolicy: string;
    jobTemplate: {
      spec: {
        metadata?: Partial<KubeMetadata>;
        template: {
          spec: {
            metadata?: Partial<KubeMetadata>;
            containers: KubeContainer[];
          };
        };
      };
    };
    [otherProps: string]: any;
  };
  status: {
    [otherProps: string]: any;
  };
}

class CronJob extends KubeObject<KubeCronJob> {
  static kind = 'CronJob';
  static apiName = 'cronjobs';
  static apiVersion = ['batch/v1', 'batch/v1beta1'];
  static isNamespaced = true;

  static apiEndpoint = apiFactoryWithNamespace(
    ['batch', 'v1', 'cronjobs'],
    ['batch', 'v1beta1', 'cronjobs']
  );

  get spec() {
    return this.getValue('spec');
  }

  get status() {
    return this.getValue('status');
  }

  getContainers(): KubeContainer[] {
    return this.spec.jobTemplate?.spec?.template?.spec?.containers || [];
  }
}

export default CronJob;

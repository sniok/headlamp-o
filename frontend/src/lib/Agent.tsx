/*
 * Copyright 2025 The Kubernetes Authors
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 * http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */

import { createAzure } from '@ai-sdk/azure';
import { useChat } from '@ai-sdk/react';
import { Box, Button } from '@mui/material';
import { CoreMessage, streamText } from 'ai';
import Markdown from 'react-markdown';
import { z } from 'zod';
import { Link } from '../components/common';
import { KubeIcon } from '../components/resourceMap/kubeIcon/KubeIcon';
import { getCluster } from './cluster';
import { clusterFetch } from './k8s/api/v2/fetch';

const model = createAzure({
  resourceName: 'olek-ai-testing-2',
  apiKey: '',
  apiVersion: '2024-12-01-preview',
})('gpt-4.1-mini');

function removePropertyRecursively(obj, propertyToRemove) {
  if (Array.isArray(obj)) {
    // If it's an array, iterate over its items
    for (const item of obj) {
      removePropertyRecursively(item, propertyToRemove);
    }
  } else if (typeof obj === 'object' && obj !== null) {
    // If it's an object, check its properties
    for (const key in obj) {
      if (key === propertyToRemove) {
        delete obj[key];
      } else {
        // Recurse on nested objects/arrays
        removePropertyRecursively(obj[key], propertyToRemove);
      }
    }
  }
  return obj;
}

function errorHandler(error: unknown) {
  if (error == null) {
    return 'unknown error';
  }

  if (typeof error === 'string') {
    return error;
  }

  if (error instanceof Error) {
    return error.message;
  }

  return JSON.stringify(error);
}

const fakeFetch = async (url: RequestInfo | URL, options: any) => {
  const m = JSON.parse(options.body) as any;

  // remove message with the request tool call result if it's an old one (<5 messages ago)

  m.messages.forEach((message: any, i: number) => {
    // if (i > m.messages.length - 2) return;
    if (message.role === 'assistant') {
      message.parts.forEach(part => {
        if (
          part.type === 'tool-invocation' &&
          (part.toolInvocation.result as string).length > 10_000
        ) {
          part.toolInvocation.result =
            '##TOOL RESULT WAS REMOVED TO REDUCE CONTEXT USAGE, MAKE THE REQUEST AGAIN IF YOU NEED THE RESULT##';
        }
      });
    }
  });

  const result = await streamText({
    model,
    system: `You are a helpful kubernetes AI assistant inside Headlamp kubernetes UI.
      Be proactive and somewhat autonomous, making GET requests is free so you don't have to ask for approval. 
      When asked for information or to perform checks, automatically gather relevant detailed data and provide a comprehensive response without asking for further confirmation, unless explicitly instructed otherwise.
      You MUST always display links to resources when showing their name. 
      Links MUST be in the following format [Resource name](#kube:Kind:Name:Namespace), so for example [my-pod](#kube:Pod:my-pod:default).
      When reuqesting a list of resources you MUST use the Table format in the request header,
      Never display output as a markdown table, use simple lists with links.
      Don't show too many items at once, usually no more than 10 items, but don't forget to mention that.
      Accept: 'application/json;as=Table;v=v1;g=meta.k8s.io,application/json;as=Table;v=v1beta1;g=meta.k8s.io,application/json'`,
    messages: m.messages,
    abortSignal: options.signal,
    maxSteps: 10,
    tools: {
      // displayLinks: {
      //   description: 'Displays simple links to kubernetes objects.',
      //   parameters: z.object({
      //     items: z.array(
      //       z.object({
      //         kind: z.string(),
      //         name: z.string(),
      //         namespace: z.string().optional(),
      //       })
      //     ),
      //   }),
      //   execute: async () => '',
      // },
      wait: {
        description: 'Pauses for a bit to wait some operations to finish',
        parameters: z.object({
          timeMs: z.number().describe('How long to wait, in ms'),
        }),
        execute: ({ timeMs }) => new Promise(resolve => setTimeout(resolve, timeMs)),
      },
      //   displayKubernetesObjectTable: {
      //     description: 'Displays small simple table of resources',
      //     parameters: z.object({
      //       items: z.array(
      //         z.object({
      //           kind: z.string(),
      //           name: z.string(),
      //           namespace: z.string().optional(),
      //         })
      //       ),
      //     }),
      //   },
      kubeApiRequest: {
        description: 'Make HTTP request to kubernetes kube-apiserver',
        parameters: z.object({
          url: z.string().describe('url path, for example /api/v1/pods'),
          method: z.string().describe('http method'),
          body: z.any().optional().describe('request body'),
          description: z
            .string()
            .describe(
              'human friendly description of this request. For example: Checking out Pods, Deleting a Secret named sample-secret, Fetching Logs.'
            ),
          otherParams: z.object({
            headersArray: z.array(
              z.object({
                name: z.string(),
                value: z.string(),
              })
            ),
          }),
        }),
        execute: async ({ url, method, body, otherParams }) => {
          const init: any = {
            method,
            headers: {
              Accept:
                'application/json;as=Table;v=v1;g=meta.k8s.io,application/json;as=Table;v=v1beta1;g=meta.k8s.io,application/json',
            },
            cluster: getCluster()!,
          };
          otherParams.headersArray.forEach(h => {
            init.headers[h.name] = h.value;
          });

          if (!!body) {
            init.body = JSON.stringify(body);
            init.headers['Content-Type'] = 'application/json';
          }
          try {
            const response = await clusterFetch(url, init)
              .then(it => it.json())
              .then(it => {
                // Recursively remove a property from json object
                removePropertyRecursively(it, 'columnDefinitions');
                return removePropertyRecursively(it, 'managedFields');
              })
              .then(it => JSON.stringify(it));

            if (init.method === 'DELETE') {
              return 'Ok';
            }

            if (response.length > 50_000) {
              return "Response removed since it's too long >50000 characters";
            }

            return response;
          } catch (e: any) {
            return 'Error!: ' + e.message;
          }
        },
      },
    },
  });
  return result.toDataStreamResponse({
    getErrorMessage: errorHandler,
  });
};

export function AgentPage() {
  const { messages, input, handleInputChange, handleSubmit, setMessages, error } = useChat({
    fetch: fakeFetch,
    maxSteps: 10,
    experimental_throttle: 300,

    async onToolCall({ toolCall }) {
      console.log('tool call', toolCall);
    },
  });
  return (
    <Box sx={{ height: '100%', display: 'flex', flexDirection: 'column', padding: '60px' }}>
      {error && (
        <div>
          {error.message} {error.stack}
        </div>
      )}
      <div
        style={{
          display: 'flex',
          flexGrow: 1,
          flexDirection: 'column-reverse',
          maxHeight: '100%',
          overflowY: 'auto',
        }}
      >
        {[...messages].reverse().map(it => (
          <div key={it.id}>
            <div style={{ textAlign: it.role === 'user' ? 'right' : 'left' }}>
              {it.parts.map(part => {
                if (part.type === 'text')
                  return (
                    <Markdown
                      key={part.text}
                      components={{
                        a: ({ href, children }) =>
                          href?.startsWith('#kube') ? (
                            <Box
                              sx={{
                                display: 'inline-flex',
                                alignItems: 'center',
                                verticalAlign: 'middle',
                              }}
                            >
                              <KubeIcon
                                kind={href.split(':')[1] as any}
                                width="24px"
                                height="24px"
                                style={{ display: 'inline-flex' }}
                              />
                              <Link
                                routeName={href.split(':')[1]}
                                params={{
                                  name: href.split(':')[2],
                                  namespace: href.split(':')[3],
                                }}
                              >
                                {children}
                              </Link>
                            </Box>
                          ) : (
                            <a href={href}>{children}</a>
                          ),
                      }}
                    >
                      {part.text}
                    </Markdown>
                  );

                if (
                  part.type === 'tool-invocation' &&
                  part.toolInvocation.toolName === 'kubeApiRequest'
                ) {
                  return (
                    <div key={part.toolInvocation.toolCallId}>
                      {part.toolInvocation.args.description}
                    </div>
                  );
                }
              })}
            </div>
          </div>
        ))}
      </div>
      <form onSubmit={handleSubmit}>
        <input
          autoComplete="off"
          name="prompt"
          value={input}
          onChange={handleInputChange}
          style={{ width: '100%', height: '50px', borderRadius: '6px' }}
        />
        <Button variant="contained" type="submit">
          Send
        </Button>
        <Button onClick={() => setMessages([])}>Clear</Button>
      </form>
    </Box>
  );
}

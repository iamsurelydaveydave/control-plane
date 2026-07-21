import * as k8s from "@kubernetes/client-node";
import { WebSocket } from "ws";
import { Writable, Readable } from "stream";
import { logger } from "../utils";
import { BadRequestError, NotFoundError, InternalServerError } from "../utils/error";
import { K8S_KUBECONFIG } from "../config";

// Message types for WebSocket protocol
export type TExecInputMessage =
  | { type: "input"; data: string }
  | { type: "resize"; cols: number; rows: number };

export type TExecOutputMessage =
  | { type: "output"; data: string }
  | { type: "exit"; code: number }
  | { type: "error"; message: string };

export type TExecResult = {
  stdout: string;
  stderr: string;
  exitCode: number;
};

export type TShellSession = {
  attach: (clientWs: WebSocket) => void;
  resize: (cols: number, rows: number) => void;
  close: () => void;
};

/**
 * Get configured Kubernetes API client
 */
function getKubeConfig(): k8s.KubeConfig {
  const kc = new k8s.KubeConfig();

  const kubeconfigPath = K8S_KUBECONFIG || process.env.KUBECONFIG;
  if (kubeconfigPath) {
    kc.loadFromFile(kubeconfigPath);
  } else {
    // Try in-cluster config first, then default kubeconfig
    try {
      kc.loadFromCluster();
    } catch {
      kc.loadFromDefault();
    }
  }

  return kc;
}

/**
 * Pod exec service for executing commands in Kubernetes pods
 */
export function usePodExecService() {
  const kc = getKubeConfig();
  const coreApi = kc.makeApiClient(k8s.CoreV1Api);
  const exec = new k8s.Exec(kc);

  /**
   * Execute a one-shot command in a pod container
   */
  async function execCommand(
    namespace: string,
    podName: string,
    container: string,
    command: string[]
  ): Promise<TExecResult> {
    if (!namespace || !podName || !container) {
      throw new BadRequestError("Missing required parameters: namespace, podName, container");
    }
    if (!command || command.length === 0) {
      throw new BadRequestError("Command array cannot be empty");
    }

    // Verify pod exists
    try {
      await coreApi.readNamespacedPod(podName, namespace);
    } catch (err: any) {
      if (err.statusCode === 404 || err.response?.statusCode === 404) {
        throw new NotFoundError(`Pod ${podName} not found in namespace ${namespace}`);
      }
      throw new InternalServerError(`Failed to verify pod: ${err.message}`);
    }

    return new Promise((resolve, reject) => {
      let stdout = "";
      let stderr = "";

      const stdoutStream = new Writable({
        write(chunk, _encoding, callback) {
          stdout += chunk.toString();
          callback();
        },
      });

      const stderrStream = new Writable({
        write(chunk, _encoding, callback) {
          stderr += chunk.toString();
          callback();
        },
      });

      exec
        .exec(
          namespace,
          podName,
          container,
          command,
          stdoutStream,
          stderrStream,
          null, // stdin
          false, // tty
          (status: k8s.V1Status) => {
            const exitCode =
              status.status === "Success" ? 0 : parseInt(status.details?.causes?.[0]?.message || "1", 10);
            resolve({ stdout, stderr, exitCode });
          }
        )
        .catch((err) => {
          logger.log({
            level: "error",
            message: `[pod-exec] exec failed: ${err.message}`,
          });
          reject(new InternalServerError(`Exec failed: ${err.message}`));
        });
    });
  }

  /**
   * Create an interactive shell session for a pod container.
   * Returns handlers to attach a WebSocket, resize the terminal, and close the session.
   */
  function createShellSession(
    namespace: string,
    podName: string,
    container: string
  ): TShellSession {
    if (!namespace || !podName || !container) {
      throw new BadRequestError("Missing required parameters: namespace, podName, container");
    }

    let k8sWebSocket: WebSocket | null = null;
    let clientWs: WebSocket | null = null;
    let isAttached = false;
    let pendingResize: { cols: number; rows: number } | null = null;

    /**
     * Send a message to the client WebSocket
     */
    function sendToClient(message: TExecOutputMessage) {
      if (clientWs && clientWs.readyState === WebSocket.OPEN) {
        clientWs.send(JSON.stringify(message));
      }
    }

    /**
     * Attach a client WebSocket to this shell session
     */
    function attach(ws: WebSocket) {
      if (isAttached) {
        ws.close(4000, "Session already attached");
        return;
      }

      clientWs = ws;
      isAttached = true;

      // Start the exec session
      const shell = ["/bin/sh", "-c", "TERM=xterm-256color; export TERM; exec /bin/sh -i"];

      logger.log({
        level: "info",
        message: `[pod-exec] Starting shell session for ${namespace}/${podName}/${container}`,
      });

      // Create a readable stream for stdin that we can write to
      const stdinStream = new Readable({
        read() {},
      });

      const stdoutStream = new Writable({
        write(chunk, _encoding, callback) {
          sendToClient({ type: "output", data: chunk.toString() });
          callback();
        },
      });

      const stderrStream = new Writable({
        write(chunk, _encoding, callback) {
          sendToClient({ type: "output", data: chunk.toString() });
          callback();
        },
      });

      exec
        .exec(
          namespace,
          podName,
          container,
          shell,
          stdoutStream,
          stderrStream,
          stdinStream,
          true, // tty
          (status: k8s.V1Status) => {
            const exitCode =
              status.status === "Success" ? 0 : parseInt(status.details?.causes?.[0]?.message || "1", 10);
            logger.log({
              level: "info",
              message: `[pod-exec] Shell session ended for ${namespace}/${podName}/${container}, exit code: ${exitCode}`,
            });
            sendToClient({ type: "exit", code: exitCode });
            close();
          }
        )
        .then((websocket) => {
          k8sWebSocket = websocket as unknown as WebSocket;

          // Apply any pending resize
          if (pendingResize) {
            resize(pendingResize.cols, pendingResize.rows);
            pendingResize = null;
          }
        })
        .catch((err) => {
          logger.log({
            level: "error",
            message: `[pod-exec] Failed to start shell: ${err.message}`,
          });
          sendToClient({ type: "error", message: `Failed to start shell: ${err.message}` });
          close();
        });

      // Handle client messages
      ws.on("message", (data) => {
        try {
          const message = JSON.parse(data.toString()) as TExecInputMessage;

          if (message.type === "input") {
            // Write stdin to the k8s exec session
            stdinStream.push(message.data);
          } else if (message.type === "resize") {
            resize(message.cols, message.rows);
          }
        } catch (err) {
          logger.log({
            level: "warn",
            message: `[pod-exec] Invalid message from client: ${err}`,
          });
        }
      });

      ws.on("close", () => {
        logger.log({
          level: "info",
          message: `[pod-exec] Client disconnected from ${namespace}/${podName}/${container}`,
        });
        close();
      });

      ws.on("error", (err) => {
        logger.log({
          level: "error",
          message: `[pod-exec] Client WebSocket error: ${err.message}`,
        });
        close();
      });
    }

    /**
     * Resize the terminal
     */
    function resize(cols: number, rows: number) {
      if (!k8sWebSocket) {
        // Queue the resize for when the connection is established
        pendingResize = { cols, rows };
        return;
      }

      // Send resize control message to K8s
      // The K8s exec protocol uses channel 4 for resize messages
      // Format: JSON {"Width": cols, "Height": rows}
      try {
        const resizeMessage = JSON.stringify({ Width: cols, Height: rows });
        const resizeBuffer = Buffer.alloc(resizeMessage.length + 1);
        resizeBuffer.writeUInt8(4, 0); // Channel 4 is for resize
        resizeBuffer.write(resizeMessage, 1);

        if (k8sWebSocket.readyState === WebSocket.OPEN) {
          k8sWebSocket.send(resizeBuffer);
        }
      } catch (err) {
        logger.log({
          level: "warn",
          message: `[pod-exec] Failed to send resize: ${err}`,
        });
      }
    }

    /**
     * Close the session and cleanup
     */
    function close() {
      isAttached = false;

      if (k8sWebSocket) {
        try {
          k8sWebSocket.close();
        } catch {
          // Ignore close errors
        }
        k8sWebSocket = null;
      }

      if (clientWs) {
        try {
          if (clientWs.readyState === WebSocket.OPEN) {
            clientWs.close(1000, "Session closed");
          }
        } catch {
          // Ignore close errors
        }
        clientWs = null;
      }
    }

    return { attach, resize, close };
  }

  /**
   * List pods in a namespace or across all namespaces
   */
  async function listPods(namespace?: string, labelSelector?: string) {
    try {
      let response;
      if (namespace) {
        response = await coreApi.listNamespacedPod(
          namespace,
          undefined, // pretty
          undefined, // allowWatchBookmarks
          undefined, // _continue
          undefined, // fieldSelector
          labelSelector
        );
      } else {
        response = await coreApi.listPodForAllNamespaces(
          undefined, // allowWatchBookmarks
          undefined, // _continue
          undefined, // fieldSelector
          labelSelector
        );
      }

      return response.body.items.map((pod) => ({
        name: pod.metadata?.name,
        namespace: pod.metadata?.namespace,
        status: pod.status?.phase,
        ready: pod.status?.containerStatuses?.every((c) => c.ready) ?? false,
        containers: pod.spec?.containers?.map((c) => c.name) ?? [],
        nodeName: pod.spec?.nodeName,
        createdAt: pod.metadata?.creationTimestamp,
        labels: pod.metadata?.labels,
      }));
    } catch (err: any) {
      logger.log({
        level: "error",
        message: `[pod-exec] Failed to list pods: ${err.message}`,
      });
      throw new InternalServerError(`Failed to list pods: ${err.message}`);
    }
  }

  /**
   * Get pod details
   */
  async function getPod(namespace: string, podName: string) {
    try {
      const response = await coreApi.readNamespacedPod(podName, namespace);
      const pod = response.body;

      return {
        name: pod.metadata?.name,
        namespace: pod.metadata?.namespace,
        status: pod.status?.phase,
        ready: pod.status?.containerStatuses?.every((c) => c.ready) ?? false,
        containers:
          pod.spec?.containers?.map((c) => ({
            name: c.name,
            image: c.image,
            ready: pod.status?.containerStatuses?.find((cs) => cs.name === c.name)?.ready ?? false,
            restartCount: pod.status?.containerStatuses?.find((cs) => cs.name === c.name)?.restartCount ?? 0,
            state: pod.status?.containerStatuses?.find((cs) => cs.name === c.name)?.state,
          })) ?? [],
        nodeName: pod.spec?.nodeName,
        createdAt: pod.metadata?.creationTimestamp,
        labels: pod.metadata?.labels,
        conditions: pod.status?.conditions,
        hostIP: pod.status?.hostIP,
        podIP: pod.status?.podIP,
      };
    } catch (err: any) {
      if (err.statusCode === 404 || err.response?.statusCode === 404) {
        throw new NotFoundError(`Pod ${podName} not found in namespace ${namespace}`);
      }
      throw new InternalServerError(`Failed to get pod: ${err.message}`);
    }
  }

  /**
   * Get pod logs
   */
  async function getPodLogs(
    namespace: string,
    podName: string,
    options: {
      container?: string;
      tailLines?: number;
      follow?: boolean;
      sinceSeconds?: number;
      timestamps?: boolean;
    } = {}
  ) {
    try {
      const response = await coreApi.readNamespacedPodLog(
        podName,
        namespace,
        options.container,
        undefined, // follow
        undefined, // insecureSkipTLSVerifyBackend
        undefined, // limitBytes
        undefined, // pretty
        undefined, // previous
        options.sinceSeconds,
        options.tailLines,
        options.timestamps
      );

      return { logs: response.body };
    } catch (err: any) {
      if (err.statusCode === 404 || err.response?.statusCode === 404) {
        throw new NotFoundError(`Pod ${podName} not found in namespace ${namespace}`);
      }
      throw new InternalServerError(`Failed to get pod logs: ${err.message}`);
    }
  }

  return {
    exec: execCommand,
    createShellSession,
    listPods,
    getPod,
    getPodLogs,
  };
}

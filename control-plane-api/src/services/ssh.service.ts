import { NodeSSH, SSHExecCommandResponse } from 'node-ssh'
import { logger } from '../utils'
import { InternalServerError } from '../utils/error'

/** Default SSH connection timeout in milliseconds */
const DEFAULT_CONNECT_TIMEOUT = 30_000

/** Default command execution timeout in milliseconds */
const DEFAULT_COMMAND_TIMEOUT = 60_000

interface SSHConnectionOptions {
  host: string
  port?: number
  username: string
  privateKey: string
  /** Connection timeout in milliseconds (default: 30s) */
  timeout?: number
}

interface CommandResult {
  stdout: string
  stderr: string
  code: number
}

interface TestConnectionResult {
  success: boolean
  error?: string
}

/**
 * Creates an SSH service instance for managing remote connections.
 * Each call returns a fresh instance with its own connection state.
 *
 * @example
 * const ssh = useSSHService()
 * await ssh.connect({ host: '192.168.1.100', username: 'root', privateKey: '...' })
 * const result = await ssh.executeCommand('uname -a')
 * await ssh.disconnect()
 */
export function useSSHService() {
  let ssh: NodeSSH | null = null
  let currentHost: string | null = null

  /**
   * Establishes an SSH connection to a remote host.
   *
   * @throws {InternalServerError} If connection fails
   */
  async function connect(opts: SSHConnectionOptions): Promise<void> {
    const { host, port = 22, username, privateKey, timeout = DEFAULT_CONNECT_TIMEOUT } = opts

    // Disconnect any existing connection first
    if (ssh?.isConnected()) {
      logger.debug(`[SSH] Disconnecting existing connection to ${currentHost}`)
      await disconnect()
    }

    logger.info(`[SSH] Connecting to ${username}@${host}:${port}`)

    try {
      ssh = new NodeSSH()

      await ssh.connect({
        host,
        port,
        username,
        privateKey,
        readyTimeout: timeout,
        keepaliveInterval: 10_000,
        keepaliveCountMax: 3,
      })

      currentHost = host
      logger.info(`[SSH] Connected to ${host}`)
    } catch (error) {
      ssh = null
      currentHost = null
      const message = error instanceof Error ? error.message : 'Unknown SSH connection error'
      logger.error(`[SSH] Connection failed to ${host}: ${message}`)
      throw new InternalServerError(`SSH connection failed: ${message}`)
    }
  }

  /**
   * Executes a command on the remote host.
   *
   * @param command - The shell command to execute
   * @param options - Optional execution options
   * @returns Command result with stdout, stderr, and exit code
   * @throws {InternalServerError} If not connected or command execution fails
   */
  async function executeCommand(
    command: string,
    options?: {
      /** Working directory for the command */
      cwd?: string
      /** Command timeout in milliseconds (default: 60s) */
      timeout?: number
      /** Stream stdout/stderr to logger */
      stream?: boolean
    }
  ): Promise<CommandResult> {
    if (!ssh?.isConnected()) {
      throw new InternalServerError('SSH not connected. Call connect() first.')
    }

    const { cwd, timeout = DEFAULT_COMMAND_TIMEOUT, stream = false } = options ?? {}

    logger.debug(`[SSH] Executing on ${currentHost}: ${command}`)

    try {
      // Create abort controller for timeout
      const controller = new AbortController()
      const timeoutId = setTimeout(() => controller.abort(), timeout)

      const execOptions: Parameters<NodeSSH['execCommand']>[1] = {
        cwd,
        onStdout: stream
          ? (chunk: Buffer) => logger.debug(`[SSH:stdout] ${chunk.toString().trim()}`)
          : undefined,
        onStderr: stream
          ? (chunk: Buffer) => logger.warn(`[SSH:stderr] ${chunk.toString().trim()}`)
          : undefined,
      }

      const result: SSHExecCommandResponse = await Promise.race([
        ssh.execCommand(command, execOptions),
        new Promise<never>((_, reject) => {
          controller.signal.addEventListener('abort', () => {
            reject(new Error(`Command timed out after ${timeout}ms`))
          })
        }),
      ])

      clearTimeout(timeoutId)

      logger.debug(`[SSH] Command completed with code ${result.code ?? 0}`)

      return {
        stdout: result.stdout,
        stderr: result.stderr,
        code: result.code ?? 0,
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown command execution error'
      logger.error(`[SSH] Command failed on ${currentHost}: ${message}`)
      throw new InternalServerError(`SSH command failed: ${message}`)
    }
  }

  /**
   * Closes the SSH connection and cleans up resources.
   */
  async function disconnect(): Promise<void> {
    if (ssh) {
      const host = currentHost
      try {
        ssh.dispose()
        logger.info(`[SSH] Disconnected from ${host}`)
      } catch (error) {
        const message = error instanceof Error ? error.message : 'Unknown disconnect error'
        logger.warn(`[SSH] Error during disconnect from ${host}: ${message}`)
      } finally {
        ssh = null
        currentHost = null
      }
    }
  }

  /**
   * Tests if SSH connection can be established to a host.
   * Automatically cleans up the test connection.
   *
   * @returns Object indicating success/failure with optional error message
   */
  async function testConnection(opts: SSHConnectionOptions): Promise<TestConnectionResult> {
    const { host, port = 22, username, privateKey, timeout = 10_000 } = opts
    const testSSH = new NodeSSH()

    logger.info(`[SSH] Testing connection to ${username}@${host}:${port}`)

    try {
      await testSSH.connect({
        host,
        port,
        username,
        privateKey,
        readyTimeout: timeout,
      })

      // Run a simple command to verify the connection works
      const result = await testSSH.execCommand('echo "connection_test"')

      testSSH.dispose()

      if (result.stdout.trim() === 'connection_test') {
        logger.info(`[SSH] Connection test successful for ${host}`)
        return { success: true }
      }

      logger.warn(`[SSH] Connection test unexpected output for ${host}: ${result.stdout}`)
      return { success: false, error: 'Unexpected command output' }
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown error'
      logger.warn(`[SSH] Connection test failed for ${host}: ${message}`)

      // Clean up on error
      try {
        testSSH.dispose()
      } catch {
        // Ignore cleanup errors
      }

      return { success: false, error: message }
    }
  }

  /**
   * Checks if currently connected.
   */
  function isConnected(): boolean {
    return ssh?.isConnected() ?? false
  }

  /**
   * Gets the current host if connected.
   */
  function getHost(): string | null {
    return currentHost
  }

  return {
    connect,
    executeCommand,
    disconnect,
    testConnection,
    isConnected,
    getHost,
  }
}

export type SSHService = ReturnType<typeof useSSHService>

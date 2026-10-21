/**
 * Typed wrapper around the Pyodide worker.
 *
 * The worker is created with `{ type: 'module' }` because Pyodide's loader is an
 * ES module and modern Pyodide refuses to run in a classic worker.  Vite compiles
 * this worker reference into its own bundle at build time.
 */

import type {
  BootStage,
  MapConfig,
  ProbeResult,
  RenderStats,
  RuleSpec,
  WorkerMessage,
  WorkerRequest,
} from './types';

export interface WorkerEvents {
  onProgress(stage: BootStage, message: string, pct: number | null): void;
  onReady(probe: ProbeResult): void;
  onRender(id: number, mime: string, base64: string, script: string, stats: RenderStats): void;
  onError(id: number | null, message: string, traceback?: string): void;
}

export class PyodideClient {
  private readonly worker: Worker;
  private nextId = 1;

  constructor(private readonly events: WorkerEvents) {
    this.worker = new Worker(new URL('../worker/pyodide.worker.ts', import.meta.url), {
      type: 'module',
      name: 'pyodide',
    });
    this.worker.onmessage = (event: MessageEvent<WorkerMessage>) => this.receive(event.data);
    this.worker.onerror = (event) => {
      // A worker-level error means the module itself failed to load, so there is
      // no id to match against -- surface it as a boot failure.
      this.events.onError(null, event.message || 'The Python worker failed to start.');
    };
  }

  boot(dataUrl: string): void {
    this.send({ type: 'boot', dataUrl });
  }

  render(config: MapConfig, rules: RuleSpec[]): number {
    const id = this.nextId++;
    this.send({ type: 'render', id, config, rules });
    return id;
  }

  export(format: 'png' | 'svg', dpi: number): number {
    const id = this.nextId++;
    this.send({ type: 'export', id, format, dpi });
    return id;
  }

  dispose(): void {
    this.worker.terminate();
  }

  private send(request: WorkerRequest): void {
    this.worker.postMessage(request);
  }

  private receive(message: WorkerMessage): void {
    switch (message.type) {
      case 'progress':
        this.events.onProgress(message.stage, message.message, message.pct);
        break;
      case 'ready':
        this.events.onReady(message.probe);
        break;
      case 'result':
        this.events.onRender(
          message.id,
          message.mime,
          message.base64,
          message.script,
          message.stats,
        );
        break;
      case 'error':
        this.events.onError(message.id, message.message, message.traceback);
        break;
    }
  }
}

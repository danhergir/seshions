declare module "node-pty" {
  export interface IPty {
    onData(listener: (data: string) => void): void
    onExit(listener: (event: { exitCode: number; signal?: number }) => void): void
    write(data: string): void
    resize(cols: number, rows: number): void
    kill(signal?: string): void
  }

  export interface ISpawnOptions {
    name?: string
    cols?: number
    rows?: number
    cwd?: string
    env?: Record<string, string>
  }

  export function spawn(file: string, args?: string[], options?: ISpawnOptions): IPty
}

import { Request } from "../DebugBridges/APIRequest";

export interface ChannelInterface {

    openConnection(maxAttempts?: number): Promise<boolean>;

    write(data: string, cb?: ((err?: Error | undefined) => void) | undefined): boolean;

    disconnect(): void;

    request(req: Request): Promise<string>;

    addCallback(dataCheck: (line: string) => boolean, cb: (line: string) => void): void;
}
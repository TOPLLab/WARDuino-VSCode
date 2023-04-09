import { ReadlineParser, SerialPort } from 'serialport';
import { ChannelInterface, Request } from './ChannelInterface';

export class SerialChannel implements ChannelInterface {

    public readonly baudrate: number;
    public readonly port: string;
    private connection: any;

    constructor(port: string, baudrate: number) {
        this.baudrate = baudrate;
        this.port = port;
    }


    public addCallback(dataCheck: (line: string) => boolean, cb: (line: string) => void): void {
        throw Error("not implemented");
    }


    addPriorityCallback(matchCheck: (line: string) => boolean, cb: (line: string) => void): void {
        throw Error("To implement");
    }

    write(data: string, cb?: ((err?: Error | undefined) => void) | undefined): boolean {
        return false;
    }

    request(req: Request): Promise<string> {
        throw Error("To implement");
    }

    disconnect(): void {
        this.connection?.close();
    }

    openConnection(maxAttempts?: number): Promise<boolean> {
        return new Promise<boolean>((resolve, reject) => {
            let con = new SerialPort({ path: this.port, baudRate: this.baudrate },
                (error) => {
                    if (error) {
                        reject(error);
                    } else {
                        this.connection = con;
                        resolve(true);
                    }
                });
        });
    }
}
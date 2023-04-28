import { ReadlineParser, SerialPort } from 'serialport';
import { ChannelInterface } from './ChannelInterface';
import { AbstractChannel } from './AbstractChannel';


export class SerialChannel extends AbstractChannel implements ChannelInterface {

    public readonly baudrate: number;
    public readonly port: string;

    constructor(port: string, baudrate: number) {
        super(`SerialConnection (${port})`)
        this.baudrate = baudrate;
        this.port = port;
    }


    public write(data: string, cb?: ((err?: Error | undefined) => void) | undefined): boolean {
        return !!this.connection && this.connection.write(data);
    }

    public disconnect(): void {
        this.connection?.close();
        this.connection = undefined;
    }

    public openConnection(maxAttempts?: number): Promise<boolean> {
        return new Promise<boolean>((resolve, reject) => {
            let con = new SerialPort({ path: this.port, baudRate: this.baudrate },
                (error) => {
                    if (error) {
                        reject(error);
                    } else {
                        this.connection = con;
                        this.registerListeners();
                        resolve(true);
                    }
                });
        });
    }
}
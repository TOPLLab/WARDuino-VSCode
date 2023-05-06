import { ReadlineParser, SerialPort } from 'serialport';

export class LoggingSerialMonitor {

    public readonly loggername: string;
    public readonly baudrate: number;
    public readonly port: string;
    private connection: any;

    constructor(loggername: string, port: string, baudrate: number) {
        this.loggername = `${loggername} (Monitor)`;
        this.baudrate = baudrate;
        this.port = port;
    }

    openConnection(): Promise<void> {
        return new Promise<void>((resolve, reject) => {
            let con = new SerialPort({ path: this.port, baudRate: this.baudrate },
                (error) => {
                    if (error) {
                        reject(error);
                    } else {
                        this.connection = con;
                        this.installLogger();
                        resolve();
                    }
                });
        });

    }

    disconnect(): void {
        this.connection?.close();
    }

    private installLogger(): void {
        const parser = new ReadlineParser();
        this.connection?.pipe(parser);
        parser.on('data', (line: string) => {
            console.log(`${this.loggername}: ${line}`);
        });
    }
}
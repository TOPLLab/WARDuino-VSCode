import { ReadlineParser, SerialPort } from 'serialport';
import { ChannelInterface } from './ChannelInterface';
import { Request } from '../DebugBridges/APIRequest';

type FutureResolver = (value: string | PromiseLike<string>) => void;

export abstract class AbstractChannel implements ChannelInterface {

    private channelName: string;
    protected connection: any;
    private dataBuffered: string = '';
    private requests: [Request, FutureResolver][];
    private callbacks: [(line: string) => boolean, (line: string) => void][];
    private catchAllHandler: (line: string) => void;

    constructor(channelName: string) {
        this.channelName = channelName;
        this.requests = [];
        this.catchAllHandler = (line: string) => {
            return this.catchAllLogger(line);
        };
        this.callbacks = [];
    }


    // Abstract methods
    public abstract write(data: string, cb?: ((err?: Error | undefined) => void) | undefined): boolean;

    public abstract openConnection(maxAttempts?: number): Promise<boolean>;

    public abstract disconnect(): void;

    public addCallback(dataCheck: (line: string) => boolean, cb: (line: string) => void): void {
        this.callbacks.push([dataCheck, cb]);
    }

    public removeDataHandlers() {
        this.requests = [];
        this.callbacks = [];
    }

    public request(request: Request): Promise<string> {
        return new Promise((res, rej) => {
            this.requests.push([request, res]);
            this.write(request.dataToSend, rej);
        });
    }

    private catchAllLogger(line: string) {
        console.log(`${this.channelName}: unhandled line "${line}"`);
    }

    protected onDataHandler(data: Buffer) {
        this.dataBuffered += data.toString();
        this.handleLines(this.parseLines());
    }

    private handleLines(lines: string[]) {
        for (let i = 0; i < lines.length; i++) {
            const line = lines[i];
            const index = this.findFutureResolver(line);
            if (index !== undefined) {
                const pair = this.requests.splice(index, 1)[0];
                const resolver = pair[1];
                resolver(line);
                continue;
            }

            const cbPair = this.callbacks.find(cbpair => {
                const check = cbpair[0];
                return check(line);
            });
            const handler = !!cbPair ? cbPair[1] : this.catchAllHandler;
            handler(line);
        }
    }


    private parseLines(): string[] {
        const lines = [];
        let idx = this.dataBuffered.indexOf('\n');
        while (idx !== -1) {
            let line = this.dataBuffered.slice(0, idx);
            this.dataBuffered = this.dataBuffered.slice(idx + 1); // skip newline
            if (line.length > 0 && line.charAt(line.length - 1) === '\r') {
                line = line.slice(0, line.length - 1);
            }
            console.log(`${this.channelName}: ${line}`);
            lines.push(line);
            idx = this.dataBuffered.indexOf('\n');
        };
        return lines;
    }


    private findFutureResolver(line: string): number | undefined {
        let i = 0;
        let resultIndex: number | undefined = undefined;
        while (resultIndex === undefined && i < this.requests.length) {
            const checkForMatch = this.requests[i][0];
            if (checkForMatch.expectedResponse(line)) {
                resultIndex = i;
            }
            i += 1;
        }
        return resultIndex;
    }

    protected registerListeners() {
        if (this.connection) {
            this.connection.on('data', (data: Buffer) => {
                return this.onDataHandler(data);
            });
            this.connection.on('close', () => {
                console.error(`${this.channelName}: closed`);
            });
            this.connection.on('error', (err: any) => {
                console.error(`${this.channelName}: error occurred ${err}`);
            });
        }
    }
}
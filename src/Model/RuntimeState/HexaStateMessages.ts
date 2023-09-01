import { InterruptTypes } from '../../DebugBridges/InterruptTypes';
import { HexaEncoder } from '../../Util/hexaEncoding';

export class HexaStateMessages {

    private maxMessageSize: number;
    private messages: string[];
    private maxPayloadSize: number;
    private currentMsg: string;

    // Header data
    private nrBytesForPayloadSize = 4 * 2; // tells how big the payload is. Times 2 for hexa
    private nrBytesForInterruptKind = InterruptTypes.interruptLoadSnapshot.length; // already in hexa
    private headerSize: number;

    // Footer data
    private nrBytesForContinuation = 1 * 2; // 1 byte to tell whether all state is transferred. Times 2 for hexa
    private terminatorChar = ' \n';
    private footerSize: number;

    constructor(messageSize: number) {
        this.maxMessageSize = messageSize;
        this.messages = [];
        this.currentMsg = '';
        this.headerSize = this.nrBytesForInterruptKind + this.nrBytesForPayloadSize;
        this.footerSize = this.nrBytesForContinuation + this.terminatorChar.length;
        this.maxPayloadSize = this.maxMessageSize - this.headerSize - this.footerSize;
    }

    public enoughSpace(spaceNeeded: number): boolean {
        return this.getFreeSpace() >= spaceNeeded;
    }

    public howManyFit(headerSize: number, payloads: string[]): number {
        let amount = 0;
        let payload: string = '';
        for (let i = 0; i < payloads.length; i++) {
            payload += payloads[i];
            if (!this.enoughSpace(payload.length + headerSize)) {
                break;
            }
            amount++;
        }
        return amount;
    }

    private validatePayload(payload: string): void {
        if (this.maxPayloadSize < payload.length) {
            let errmsg = `Payload size exceeds maxPayload Size of ${this.maxPayloadSize}`;
            errmsg += `(= maxMessageSize ${this.maxMessageSize} - header/footer ${this.headerSize + this.footerSize}).`;
            errmsg += 'Either increase maxMessageSize or split payload.';
            throw (new Error(errmsg));
        }
        if (payload.length % 2 !== 0) {
            throw (new Error(`Payload is not even. Got length ${this.currentMsg.length}`));
        }
        const regexHexa = /[0-9A-Fa-f]{6}/g;
        if (!payload.match(regexHexa)) {
            throw (new Error('Payload should only contain hexa chars'));
        }

    }

    public getFreeSpace(): number {
        return this.maxPayloadSize - this.currentMsg.length;
    }

    public addPayload(payload: string): void {
        this.validatePayload(payload);
        if (!this.enoughSpace(payload.length)) {
            this.forceNewMessage();
        }
        this.currentMsg = `${this.currentMsg}${payload}`;
        const s = this.currentMsg.length + this.headerSize + this.footerSize;
        if (s > this.maxMessageSize) {
            throw (new Error(`Exceeded max size is ${s} > ${this.maxMessageSize}`));
        }
    }

    public forceNewMessage(): void {
        this.messages.push(this.currentMsg);
        this.currentMsg = '';
    }

    public getMessages(): string[] {
        if (this.currentMsg !== '') {
            this.messages = this.messages.concat(this.currentMsg);
            this.currentMsg = '';
        }

        const amountMessages = this.messages.length;
        const lastChar = this.terminatorChar;
        return this.messages.map((payload, msgIdx) => {
            const size = Math.floor(payload.length / 2);
            const sizeHexa = HexaEncoder.serializeUInt32BE(size);
            const done = (msgIdx + 1) === amountMessages ? '01' : '00';
            const msg = `${InterruptTypes.interruptLoadSnapshot}${sizeHexa}${payload}${done}${lastChar}`;
            if (msg.length % 2 !== 0) {
                throw (new Error('WoodState: Hexa message not even'));
            }
            if (msg.length > this.maxMessageSize) {
                throw (new Error(`msg ${msgIdx} is ${msg.length} > ${this.maxMessageSize}`));
            }
            return msg;
        });
    }
}

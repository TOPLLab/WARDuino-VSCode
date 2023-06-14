export class HexaEncoder {
    static serializeUInt8(n: number): string {
        return HexaEncoder.serializeUInt(n, 1, true);
    }

    static serializeUInt16BE(n: number): string {
        return HexaEncoder.serializeUInt(n, 2, true);
    }

    static serializeUInt32BE(n: number): string {
        return HexaEncoder.serializeUInt(n, 4, true);
    }

    static serializeInt32LE(n: number): string {
        return HexaEncoder.serializeUInt(n, 4, false);
    }

    static serializeUInt32LE(n: number): string {
        return HexaEncoder.serializeUInt(n, 4, false);
    }

    static serializeBigUInt64LE(n: bigint): string {
        return HexaEncoder.serializeBigUInt64(n, false);
    }

    static serializeBigUInt64BE(n: bigint): string {
        return HexaEncoder.serializeBigUInt64(n, true);
    }

    static serializeBigUInt64(n: bigint, bigendian: boolean) {
        const buff = Buffer.allocUnsafe(8);
        if (bigendian) {
            buff.writeBigUInt64BE(n);
        }
        else {
            buff.writeBigUInt64LE(n);
        }
        return buff.toString('hex');
    }

    static serializeUInt(n: number, amountBytes: number, bigendian: boolean): string {
        const buff = Buffer.allocUnsafe(amountBytes);
        if (amountBytes === 1) {
            if (n < 0) {
                buff.writeInt8(n);
            }
            else {
                buff.writeUInt8(n);
            }
        }
        else if (amountBytes === 2) {
            if (bigendian) {
                if (n < 0) {
                    buff.writeUInt16BE(n);

                }
                else {
                    buff.writeUInt16BE(n);
                }
            }
            else {
                if (n < 0) {
                    buff.writeInt16LE(n);
                }
                else {
                    buff.writeUInt16LE(n);
                }
            }

        }
        else if (amountBytes === 4) {
            if (bigendian) {
                if (n < 0) {
                    buff.writeInt32BE(n);
                }
                else {
                    buff.writeUInt32BE(n);
                }
            }
            else {
                if (n < 0) {
                    buff.writeInt32LE(n);
                }
                else {
                    buff.writeUInt32LE(n);
                }
            }
        }
        else {
            throw (new Error('invalid amount of bytes'));
        }
        return buff.toString('hex');
    };

    static serializeInt32(n: number, bigendian: boolean): string {
        const buff = Buffer.allocUnsafe(4);
        if (bigendian) {
            buff.writeInt32BE(n);
        }
        else {
            buff.writeUInt32LE(n);
        }
        return buff.toString('hex');
    }

    static serializeFloatBE(n: number): string {
        return HexaEncoder.serializeFloat(n, true);
    }

    static serializeFloatLE(n: number): string {
        return HexaEncoder.serializeFloat(n, false);
    }

    static serializeFloat(n: number, bigendian: boolean): string {
        const buff = Buffer.allocUnsafe(4);
        if (bigendian) {
            buff.writeFloatBE(n);
        }
        else {
            buff.writeFloatLE(n);
        }
        return buff.toString('hex');
    }

    static serializeDoubleBE(n: number): string {
        return HexaEncoder.serializeDouble(n, true);
    }

    static serializeDoubleLE(n: number): string {
        return HexaEncoder.serializeDouble(n, false);
    }

    static serializeDouble(n: number, bigendian: boolean): string {
        const buff = Buffer.allocUnsafe(8);
        if (bigendian) {
            buff.writeDoubleBE(n);
        }
        else {
            buff.writeDoubleLE(n);
        }
        return buff.toString('hex');
    }

    static serializeString(s: string): string {
        return s.split('').map(c => c.charCodeAt(0).toString(16).padStart(2, '0')).join('');
    }

    static convertToLEB128(a: number): string { // TODO can only handle 32 bit
        a |= 0;
        const result = [];
        while (true) {
            const byte_ = a & 0x7f;
            a >>= 7;
            if (
                (a === 0 && (byte_ & 0x40) === 0) ||
                (a === -1 && (byte_ & 0x40) !== 0)
            ) {
                result.push(byte_.toString(16).padStart(2, '0'));
                return result.join('').toUpperCase();
            }
            result.push((byte_ | 0x80).toString(16).padStart(2, '0'));
        }
    }
}
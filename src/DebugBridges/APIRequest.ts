export type Request = {
    dataToSend: string;
    responseMatchCheck: (line: string) => boolean;
}
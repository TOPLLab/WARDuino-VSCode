export class WOODState {
    private unparsedJSON = "";
    constructor(state: string) {
        this.unparsedJSON = state;
    }

    toBinary(): string {
        return ""; // TODO call python script
    }
}
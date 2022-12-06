import {Describer, ProcessBridge, TestDescription} from './Describer';

export interface Platform {
    name: string;
    bridge: ProcessBridge;
    describer: Describer;
    disabled: boolean;
}

interface Suite {
    title: string;
    tests: TestDescription[];
}

export class Framework {
    private static implementation: Framework;

    private bases: Platform[] = [];
    private suites: Suite[] = [];

    private constructor() {
    }

    private currentSuite(): Suite {
        return this.suites[this.suites.length - 1];
    }

    public platform(bridge: ProcessBridge, disabled: boolean = false) {
        const describer = new Describer(bridge);
        if (disabled) {
            describer.skipall();
        }

        this.bases.push({
            name: bridge.name,
            bridge: bridge,
            describer: describer,
            disabled: disabled
        });
    }

    public platforms(): Platform[] {
        return this.bases;
    }

    public suite(title: string) {
        this.suites.push({title: title, tests: []});
    }

    public test(test: TestDescription) {
        this.currentSuite().tests.push(test);
        this.bases.forEach((base: Platform) => {
            base.describer.describeTest(test);
        });
    }

    public static getImplementation() {
        if (!Framework.implementation) {
            Framework.implementation = new Framework();
        }

        return Framework.implementation;
    }
}
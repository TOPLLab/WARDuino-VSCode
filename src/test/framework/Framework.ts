import {TestDescription} from './Describer';

export class Framework {
    private static implementation: Framework;

    private tests: TestDescription[] = [];

    private constructor() {
    }

    public addTest(test: TestDescription) {
        this.tests.push(test);
    }

    public static getImplementation() {
        if (!Framework.implementation) {
            Framework.implementation = new Framework();
        }

        return Framework.implementation;
    }
}
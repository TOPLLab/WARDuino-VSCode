import {Framework} from './Framework';
import {TestResult, testResult} from './TestResult';

class Test {
    private readonly testResult: TestResult;

    constructor(private readonly framework: Framework, start: number = Date.now()) {
        this.testResult = testResult();
    }
}
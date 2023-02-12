import {TestScenario} from './Describer';
import {Suite} from './Framework';

export abstract class Scheduler {
    public abstract readonly identifier: string;

    // sort the tests into an efficient schedule
    abstract schedule(suite: Suite): TestScenario[];
}

class NoScheduler implements Scheduler {
    identifier = 'no schedule';

    public schedule(suite: Suite): TestScenario[] {
        return suite.tests;
    }
}

class SimpleScheduler implements Scheduler {
    identifier = 'sort on program';

    public schedule(suite: Suite): TestScenario[] {
        // get trees
        const forest = trees(suite.tests);
        // sort trees by program
        forest.forEach(tree => tree.sort((a: TestScenario, b: TestScenario) => a.program.localeCompare(b.program)));
        // flatten forest
        return forest.flat(2);
    }
}

/*
 * The Hybrid Scheduler respects dependency trees while minimising the need to change programs.
 *
 * The schedule iterates breadth-first over each tree in succession,
 * at each depth the tests are sorted alphabetically according to their program.
 */
export class HybridScheduler implements Scheduler {
    identifier = 'hybrid schedule';

    public schedule(suite: Suite): TestScenario[] {
        let scheme: TestScenario[] = [];
        const forest: TestScenario[][] = trees(suite.tests);
        for (const tree of forest) {
            const split = levels(tree);
            split.forEach(level => level.sort(sortOnProgram));
            scheme = scheme.concat(split.flat(2));
        }
        return scheme;
    }
}

export class DependenceScheduler implements Scheduler {
    identifier = 'dependence-prioritizing schedule';

    public schedule(suite: Suite): TestScenario[] {
        const schedule: TestScenario[][] = levels(suite.tests);
        schedule.forEach(level => level.sort(sortOnProgram));
        return schedule.flat(2);  // we flatten since we don't support parallelism yet (otherwise tests in the same level can be run in parallel)
    }
}

/* util functions */

function sortOnProgram(a: TestScenario, b: TestScenario) {
    // aggregate tests with the same program
    return a.program.localeCompare(b.program);
}

// aggregate dependence forest into trees
function trees(input: TestScenario[]): TestScenario[][] {
    // sort input
    input.sort(comparator);

    // output
    const forest: TestScenario[][] = [];

    // tests that have already been seen
    const seen = new Set<TestScenario>();

    // loop over all tests of the input
    for (const test of input) {
        if (seen.has(test)) {
            // test already in forest, nothing to do
            break;
        }
        // start a new tree
        let tree: TestScenario[] = [test];

        // add test to seen
        seen.add(test);

        // depth first descent over dependencies
        let lifo: TestScenario[] = [...test.dependencies ?? []];
        while (lifo.length > 0) {
            const dep = lifo.shift();

            // @ts-ignore
            if (seen.has(dep)) {
                // dependency has been seen: merge the old tree holding the dependency with the new tree
                // @ts-ignore
                const index = forest.findIndex(t => t.includes(dep));
                if (index < 0) {
                    // already merged the tree
                    break;
                }
                const oldTree = forest[index];

                // extend new tree with old tree
                tree = tree.concat(oldTree);

                // remove old tree from forest
                forest.splice(index, 1);
            } else {
                // dependency has not been seen: add dependency
                // @ts-ignore
                tree.push(dep);

                // traverse its dependencies recursively
                // @ts-ignore
                lifo = lifo.concat(dep.dependencies ?? []);

                // add dependency to seen collection
                // @ts-ignore
                seen.add(dep);
            }
        }

        // update forest
        forest.push(tree);
    }

    return forest;
}

function comparator(a: TestScenario, b: TestScenario): number {
    let comparison: number = (b.dependencies ?? []).length - (a.dependencies ?? []).length; // decreasing amount of dependencies
    if (comparison === 0) {
        comparison = sortOnProgram(a, b);
        if (comparison === 0) {
            comparison = a.title.localeCompare(b.title);
        }
    }
    return comparison;
}

// aggregate dependence forest into levels
function levels(input: TestScenario[]): TestScenario[][] {
    // input
    input.sort((a: TestScenario, b: TestScenario) => (a.dependencies ?? []).length - (b.dependencies ?? []).length);
    // output
    const levels: TestScenario[][] = [];

    // while more input remains
    while (input.length > 0) {
        // @ts-ignore
        const test: TestScenario = input.shift();

        // skip any test with unresolved dependencies
        let skip: boolean = (test.dependencies ?? []).some((dependence: TestScenario) => input.includes(dependence));

        if (skip) {
            input.push(test);
            break;
        }

        // add to level below
        const level: number = lowest(test, levels) + 1;
        if (levels[level] === undefined) {
            levels[level] = [];
        }
        levels[level].push(test);
    }

    return levels;
}

// get the lowest level of dependencies for a test
function lowest(test: TestScenario, levels: TestScenario[][]): number {
    for (let i = levels.length - 1; i >= 0; i--) {
        for (const level of levels[i] ?? []) {
            if (test.dependencies?.includes(level)) {
                return i;
            }
        }
    }
    return -1;
}
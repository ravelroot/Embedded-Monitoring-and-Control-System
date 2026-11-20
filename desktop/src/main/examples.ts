import type { Rule } from '../shared/model';

export const EXAMPLE_RULES: { slot: number; rule: Rule }[] = [
  {
    slot: 0,
    rule: { enabled: true, channel: 0, comparison: 'above', threshold: 30, hysteresis: 1.5, delayS: 5, output: 2, onValue: 1000, offValue: 0, severity: 1 },
  },
  {
    slot: 1,
    rule: { enabled: true, channel: 2, comparison: 'below', threshold: 20, hysteresis: 60, delayS: 3, output: 0, onValue: 1, offValue: 0, severity: 1 },
  },
  {
    slot: 2,
    rule: { enabled: true, channel: 0, comparison: 'above', threshold: 38, hysteresis: 2, delayS: 10, output: 1, onValue: 1, offValue: 0, severity: 3 },
  },
  {
    slot: 3,
    rule: { enabled: true, channel: 3, comparison: 'below', threshold: 4.6, hysteresis: 0.1, delayS: 5, output: null, onValue: 0, offValue: 0, severity: 2 },
  },
];

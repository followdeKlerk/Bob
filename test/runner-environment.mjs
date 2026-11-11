// Disposable tests must not inherit the service's disk-backed runtime cache on Linux.
// BOB_TEST_TMPDIR explicitly selects another filesystem (including durability probes).
// Never load this module in the production backend; live state is unchanged.
import {tmpdir} from 'node:os';
const directory = process.env.BOB_TEST_TMPDIR || (process.platform === 'linux' ? '/tmp' : tmpdir());
process.env.TMPDIR = process.env.TMP = process.env.TEMP = directory;

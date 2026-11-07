// Test-only setup: a clean shell need not export TMPDIR. Child fixtures inherit
// this short OS default; never load this module in the production backend.
import {tmpdir} from 'node:os';
process.env.TMPDIR ||= tmpdir();

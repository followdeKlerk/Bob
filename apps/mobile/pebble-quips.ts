import type {ComposerActivity} from './composer-activity';

/** Handwritten flavour, never evidence about tools, results or private reasoning.
 * Only harmless response phases have jokes; questions, retries and warnings don't. */
export const PEBBLE_QUIPS:Partial<Record<ComposerActivity['phase'],readonly string[]>>={
 thinking:[
  'One brain cell. Employee of the month.',
  'Putting two and two in the same room.',
  'A thought has entered the pebble.',
  'Small rock. Unreasonable expectations.',
  'The plot thickens. I remain pebble-shaped.',
  'Mentally pacing. Physically a blob.',
  'Finally, a use for this enormous forehead.',
  'Turning the idea over. No opposable thumbs.',
  'Some assembly required. Mostly upstairs.',
  'My train of thought has no quiet carriage.',
 ],
 working:[
  'All this, and still no pockets.',
  'Middle management would love this posture.',
  'I was promised a desk. I got a text box.',
  'Somewhere, a spreadsheet feels threatened.',
  'Tiny arms. Full-time responsibilities.',
  'The hard hat was a difficult era.',
  'Purple collar worker.',
  'My performance review better mention this.',
  'No hands. Somehow still hands-on.',
  'A very small department of getting on with it.',
 ],
 writing:[
  'Trying not to make this a trilogy.',
  'The semicolons have formed a union.',
  'Putting the words in their little outfits.',
  'A paragraph is just a sentence with roommates.',
  'My editor is also a pebble. Awkward.',
  'Keeping the adjective population under control.',
  'Resisting the urge to say “delve”.',
  'This could have been a cave painting.',
  'Sentences: now with structural integrity.',
  'The first draft had main-character energy.',
 ],
 waiting:[
  'Even my dramatic pause has a dramatic pause.',
  'I would check my watch. Wrist situation.',
  'An excellent time to remain purple.',
  'Still here. Very committed to the spot.',
  'Practising my patient little face.',
  'This is my queue-tie era.',
  'Holding music would be overkill.',
  'A pebble is basically patience with eyes.',
 ],
 preparing:[
  'Arranging my three qualifications.',
  'Squaring up to a round problem.',
  'An ambitious task for something this squishy.',
  'Right. Let’s make this look intentional.',
  'I brought the purple. You brought the plot.',
  'Getting my metaphorical sleeves involved.',
 ],
 compaction:[
  'Folding the plot until it fits.',
  'A smaller suitcase for the same adventure.',
  'The lore has exceeded the pebble.',
  'Giving the conversation a carry-on allowance.',
  'A recap episode, minus the theme tune.',
  'So much plot. Such a small rock.',
 ],
};

/** Recent history is caller-owned and bounded; samples exclude recent lines. */
export function pickPebbleQuip(phase:ComposerActivity['phase'],recent:readonly string[],random=Math.random):string|undefined {
 const pool=PEBBLE_QUIPS[phase];if(!pool?.length)return;
 const available=pool.filter(line=>!recent.includes(line));
 // Don't recycle a phase's exhausted set just to fill silence.
 if(!available.length)return;
 const index=Math.max(0,Math.min(available.length-1,Math.floor(random()*available.length)));
 return available[index];
}

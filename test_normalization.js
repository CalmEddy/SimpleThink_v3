// Test the normalization functions
const { normalizeLemma, tokenizeToLemmas } = require('./dist/lib/aspect/inferAspect.js');

console.log('Testing normalizeLemma:');
console.log("n't ->", normalizeLemma("n't"));
console.log("_ ->", normalizeLemma("_"));
console.log(". ->", normalizeLemma("."));
console.log("don't ->", normalizeLemma("don't"));
console.log("he's ->", normalizeLemma("he's"));
console.log("nt ->", normalizeLemma("nt"));

console.log('\nTesting tokenizeToLemmas:');
const testText = "You ask to see the manager and the chef's mom come out.";
console.log(`"${testText}" ->`, tokenizeToLemmas(testText));

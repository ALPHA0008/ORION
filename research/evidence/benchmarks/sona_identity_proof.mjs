// Faithful reproduction of applyLoRATransform (base.ts:111-143)
// and the init from sona-manager.ts:526-540
function applyLoRATransform(input, A, B, rank) {
  const dim = input.length;
  const output = new Float32Array(dim);
  output.set(input);
  const intermediate = new Float32Array(rank);
  for (let r = 0; r < rank; r++) {
    let sum = 0;
    for (let d = 0; d < dim; d++) sum += A[d * rank + r] * input[d];
    intermediate[r] = sum;
  }
  for (let d = 0; d < dim; d++) {
    let sum = 0;
    for (let r = 0; r < rank; r++) sum += B[r * dim + d] * intermediate[r];
    output[d] += sum;
  }
  return output;
}
const hiddenDim = 768, rank = 8;
const A = new Float32Array(hiddenDim * rank);
const B = new Float32Array(rank * hiddenDim);   // exactly as sona-manager.ts does
for (let i = 0; i < A.length; i++) A[i] = (Math.random() - 0.5) * 0.02;
// B is NEVER written — reproducing the audited code path

const input = new Float32Array(hiddenDim);
for (let i = 0; i < hiddenDim; i++) input[i] = Math.sin(i) * 0.5;

const out = applyLoRATransform(input, A, B, rank);
let maxDelta = 0, sumAbsB = 0;
for (let i = 0; i < hiddenDim; i++) maxDelta = Math.max(maxDelta, Math.abs(out[i] - input[i]));
for (let i = 0; i < B.length; i++) sumAbsB += Math.abs(B[i]);
console.log("B matrix sum(|B|)          :", sumAbsB);
console.log("max |output - input|       :", maxDelta);
console.log("output identical to input? :", maxDelta === 0);

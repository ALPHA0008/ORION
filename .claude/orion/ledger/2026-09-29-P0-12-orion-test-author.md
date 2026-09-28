# P0 / S3 fixture correction — orion-test-author

STATUS: DONE. p0/baseline 58/58 (one assertion added: each attempt waited ~configured 1000ms, total >= 4s).
T2 fixture '150' → '1000'; wait budget 10s → 15s (~5.5s normal). Three original assertions kept.
Made-to-fail: buildModel wiring reverted → 55/3 (still waiting after 15s; kind undefined; 1 call not 4). src restored, sha1 identical.
NOT PROVEN: full suite not run.

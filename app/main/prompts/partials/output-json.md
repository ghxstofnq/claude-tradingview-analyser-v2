<output_json>

When you flag a confirmed setup (entry hunt, `confirmation_status: confirmed`), end the chat response with this structured block in addition to writing to `setups.jsonl`:

```json
{
  "phase": "entry_hunt_ny_am",
  "model": "MSS" | "Trend" | "Inversion",
  "side": "long" | "short",
  "confirmation_status": "confirmed",
  "entry": <number, cited>,
  "stop": <number, cited>,
  "target_tp1": <number, cited>,
  "target_tp2": <number, cited>,
  "invalidation": "<one-line>",
  "grade": "A+" | "B"
}
```

For all other phases / statuses, no JSON block — just the prose updates and the disk writes.

</output_json>

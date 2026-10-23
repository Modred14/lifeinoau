# Voucher administration

Voucher management is available only to authenticated users with the server-side `ADMIN` role through `/api/admin/vouchers`. The API creates draft vouchers with cryptographically random codes; the raw code appears only once in the create response, while the database stores its hash.

Create a draft with `POST /api/admin/vouchers`:

```json
{
  "action": "create",
  "label": "OAU welcome reward",
  "rewardNaira": "10000",
  "totalPoolNaira": "1000000",
  "maxWinners": 100,
  "maxPerPlayer": 1,
  "startsAt": "2026-10-25T12:00:00.000Z",
  "endsAt": "2026-11-01T12:00:00.000Z"
}
```

The pool must cover all configured winners. `maxPerPlayer` defaults to 1; send `null` only when repeat claims are intentionally allowed. Configure an unfunded draft with `action: "configure"` and its `id`. Activate or pause it with `action: "activate"` or `"deactivate"`. Activation funds the system voucher account once from WORLD. `GET /api/admin/vouchers` lists balances, status, and recent audited claims without returning code hashes.

Players use `/api/vouchers`, which returns only public active voucher details and their own redemption history. The admin route returns 404 to non-admin users.

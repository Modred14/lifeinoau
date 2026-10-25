// lib/tripTarget.js
// "Where am I going?" for a trip, with the rule that the LATEST choice always wins.
//
// Choosing a destination is local and immediate. Whatever is sent to the server about a destination in the background (who is waiting there, the fare at the end) is asked about
// the place that was chosen WHEN it was asked, and its answer is used only if that place is still the one being gone to: a slow answer about an earlier choice is dropped, never
// applied over a newer one. Pure JS: runs in the browser and in the tests.

export function createTargetTracker(first = null) {
  let id = first, seq = 0;
  return {
    get id() { return id; },
    /** A ticket for the choice that is current right now. */
    get ticket() { return seq; },
    /** Choose a destination (the same one again changes nothing). Returns the new ticket. */
    choose(next) { if (next !== id) { id = next; seq++; } return seq; },
    /** Is this ticket still the latest choice? */
    isCurrent(ticket) { return ticket === seq; },
    /** Wraps a promise of an answer about the current choice: resolves with the answer, or with `stale` if a newer choice was made while it was on its way. */
    async answer(promise, stale = null) { const t = seq; const r = await promise; return t === seq ? r : stale; },
  };
}

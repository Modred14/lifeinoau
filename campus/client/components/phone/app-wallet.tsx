import { LOAN_CUT } from "@campuslife/shared";
import { naira } from "./format";

const PERCENT = 100;

export function AppWallet({ cash, debt }: { cash: number; debt: number }) {
  return (
    <>
      <section className="ph-card ph-balance">
        <span>Wallet balance</span>
        <b>{naira(cash)}</b>
      </section>
      <section className="ph-card ph-row">
        <span>Loan to repay</span>
        <b>{debt > 0 ? naira(debt) : "No loan"}</b>
      </section>
      {debt > 0 && <p className="ph-note">{Math.round(LOAN_CUT * PERCENT)}% of your job pay goes to the loan until it is cleared.</p>}
    </>
  );
}

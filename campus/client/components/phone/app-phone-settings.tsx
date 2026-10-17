import { PHONE_PLATFORM_LABEL, type Phone } from "@campuslife/shared";
import { PhoneDevice } from "./phone-device";

export function AppPhoneSettings({ phone, onStore, onLock }: { phone: Phone; onStore: () => void; onLock: () => void }) {
  return (
    <>
      <section className="ph-device-info"><PhoneDevice phone={phone} preview /><div><h3>{phone.name}</h3><p>{PHONE_PLATFORM_LABEL[phone.platform]}</p><small>{phone.spec}</small></div></section>
      <ul className="ph-list">
        <li className="ph-list-row"><span className="ph-list-text"><b>Your device</b><small>Change phones at the campus store.</small></span><button type="button" className="ph-btn" onClick={onStore}>Upgrade</button></li>
        <li className="ph-list-row"><span className="ph-list-text"><b>Lock screen</b><small>Keep your phone locked until you need it.</small></span><button type="button" className="ph-btn ph-btn-quiet" onClick={onLock}>Lock</button></li>
      </ul>
    </>
  );
}

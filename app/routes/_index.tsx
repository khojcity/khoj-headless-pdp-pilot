import {redirect} from 'react-router';

const PILOT_HANDLE = 'mor-pankh-classic-multi-color-hand-painted-necklace-set-hp-np';

export function loader() {
  return redirect(`/products/${PILOT_HANDLE}`, 302);
}

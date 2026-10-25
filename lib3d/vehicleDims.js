// lib3d/vehicleDims.js
// The real size of every vehicle in the game, in metres, as plain numbers (no three.js), so the garage layout, the driving physics and the tests can read them without
// building a model. They are the same numbers as lib3d/vehicleSpecs.js (L W H and the axle positions): a test checks that the two agree.
//   length, width (without mirrors), height, wheelbase (front axle to rear axle).
export const VEHICLE_DIMS = {
  "corolla-2011":    { length: 4.54,  width: 1.76,  height: 1.465, wheelbase: 2.60 },
  "accord-2014":     { length: 4.89,  width: 1.85,  height: 1.465, wheelbase: 2.776 },
  "camry-2014":      { length: 4.85,  width: 1.825, height: 1.47,  wheelbase: 2.775 },
  "is350-2014":      { length: 4.665, width: 1.81,  height: 1.43,  wheelbase: 2.80 },
  "cclass-2016":     { length: 4.751, width: 1.82,  height: 1.437, wheelbase: 2.865 },
  "gle-2018":        { length: 4.924, width: 1.95,  height: 1.772, wheelbase: 2.995 },
  "rrsport-2016":    { length: 4.879, width: 1.983, height: 1.803, wheelbase: 2.923 },
  "urus-2025":       { length: 5.112, width: 2.016, height: 1.638, wheelbase: 3.003 },
  "huracan-2025":    { length: 4.549, width: 1.945, height: 1.22,  wheelbase: 2.62 },
  "cybertruck-2024": { length: 5.683, width: 2.027, height: 1.791, wheelbase: 3.80 },
  keke:              { length: 2.78,  width: 1.3,   height: 1.72,  wheelbase: 1.95 },
  bus:               { length: 6.075, width: 1.882, height: 2.254, wheelbase: 4.12 },
};

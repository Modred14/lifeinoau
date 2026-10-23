// lib/cars.js
// The YK Autos showroom: the cars a player can buy in the Ride app. Plain data and rules, no React and no three.js, so the server (lib/carService.js),
// the Ride app and the tests all read the same list. The 3D bodies are in lib3d/vehicles.js (makeVehicle, keyed by `shape` below).
//
// PRICES. Every price is in whole naira and is only ever set from evidence, never guessed:
//   basis "listings"  : read from Nigerian dealer ads on Jiji.ng on 23 Oct 2026 (the range seen is in `note`).
//   basis "estimate"  : a published market estimate that is NOT a dealer quote (`note` says where it is from). Shown as "Market estimate".
//   priceNaira null   : no verified price yet. The car is shown in the showroom (specs and 3D) but cannot be bought until a price with its
//                       source is filled in here. The server refuses to sell it, whatever the screen says.
// To price a car: set `priceNaira`, `basis` ("listings" or "estimate"), and say in `note` where the number is from and when it was checked.

/** Paints a player can pick. A car with `fixedPaint` (the Cybertruck is bare steel) has only that. */
export const CAR_PAINTS = [
  { id: "#c0392b", name: "Red" }, { id: "#2c5aa0", name: "Blue" }, { id: "#e8e8e8", name: "White" }, { id: "#1f1f23", name: "Black" },
  { id: "#4a4f57", name: "Graphite" }, { id: "#d9a441", name: "Gold" }, { id: "#2e7d5b", name: "Green" }, { id: "#b9bec7", name: "Silver" },
];

export const CARS = [
  { id: "corolla-2011", name: "Toyota Corolla LE", year: 2011, condition: "Nigerian used", body: "Sedan", shape: "compact",
    specs: ["1.8L 4-cylinder, 132 hp", "4-speed automatic", "Front-wheel drive", "Petrol"],
    priceNaira: 7_000_000, basis: "listings", note: "Nigerian-used 2011 Corollas on Jiji.ng, 18 Oct 2026: ₦6.5M to ₦7.5M." },
  { id: "accord-2014", name: "Honda Accord EX-L V6", year: 2014, condition: "Foreign used", body: "Sedan", shape: "sedan",
    specs: ["3.5L V6, 278 hp", "6-speed automatic", "Front-wheel drive", "Petrol"],
    priceNaira: 11_500_000, basis: "listings", note: "Foreign-used 2013 to 2014 Accords on Jiji.ng, 18 Oct 2026: ₦11.5M to ₦12.9M." },
  { id: "camry-2014", name: "Toyota Camry XLE V6", year: 2014, condition: "Foreign used", body: "Sedan", shape: "sedan",
    specs: ["3.5L V6, 268 hp", "6-speed automatic", "Front-wheel drive", "Petrol"],
    priceNaira: 13_000_000, basis: "listings", note: "Foreign-used 2013 to 2014 Camrys on Jiji.ng, 18 Oct 2026: ₦12.8M to ₦15.5M." },
  { id: "is350-2014", name: "Lexus IS 350", year: 2014, condition: "Foreign used", body: "Sport sedan", shape: "sport",
    specs: ["3.5L V6, 306 hp", "8-speed automatic", "Rear-wheel drive", "Petrol"],
    priceNaira: 24_000_000, basis: "listings", note: "Foreign-used 2014 Lexus IS 350 listings on Jiji.ng, 23 Oct 2026: about ₦21.8M to ₦28.5M." },
  { id: "cclass-2016", name: "Mercedes-Benz C300 4MATIC", year: 2016, condition: "Foreign used", body: "Sedan", shape: "sedan",
    specs: ["2.0L turbo 4-cylinder, 241 hp", "7-speed automatic", "All-wheel drive", "Petrol"],
    priceNaira: 20_000_000, basis: "listings", note: "Foreign-used 2016 Mercedes-Benz C300 4MATIC listings on Jiji.ng, 23 Oct 2026: about ₦15.5M to ₦25M." },
  { id: "gle-2018", name: "Mercedes-Benz GLE 350 4MATIC", year: 2018, condition: "Foreign used", body: "SUV", shape: "suv",
    specs: ["3.5L V6, 302 hp", "9-speed automatic", "All-wheel drive", "Petrol"],
    priceNaira: 35_000_000, basis: "listings", note: "Foreign-used 2018 Mercedes-Benz GLE 350 listings on Jiji.ng, 23 Oct 2026: about ₦31M to ₦40M." },
  { id: "rrsport-2016", name: "Range Rover Sport HSE", year: 2016, condition: "Foreign used", body: "SUV", shape: "suv-large",
    specs: ["3.0L supercharged V6, 340 hp", "8-speed automatic", "All-wheel drive", "Petrol"],
    priceNaira: 34_000_000, basis: "listings", note: "Foreign-used 2016 Range Rover Sport HSE listings on Jiji.ng, 23 Oct 2026: about ₦32.5M to ₦35.5M." },
  { id: "cybertruck-2024", name: "Tesla Cybertruck AWD", year: 2024, condition: "Foreign used", body: "Pickup", shape: "cybertruck", fixedPaint: "#aeb3ba",
    specs: ["Dual-motor electric, about 600 hp", "Single-speed", "All-wheel drive", "Electric"],
    priceNaira: 427_500_000, basis: "estimate", note: "2024 Tesla Cybertruck Nigeria listing benchmark on Carlots.ng, 23 Oct 2026: ₦405M to ₦450M; midpoint market estimate, not a dealer quote." },
  { id: "urus-2025", name: "Lamborghini Urus", year: 2025, condition: "New (import)", body: "Super SUV", shape: "super-suv",
    specs: ["4.0L twin-turbo V8, 650+ hp", "8-speed automatic", "All-wheel drive", "Petrol"],
    priceNaira: 525_770_300, basis: "estimate", note: "arawheels.com approximate Nigerian price for a 2025 Urus. A market estimate, not a dealer quote." },
  { id: "huracan-2025", name: "Lamborghini Huracán", year: 2025, condition: "New (import)", body: "Supercar", shape: "supercar",
    specs: ["5.2L V10, 600+ hp", "7-speed dual-clutch", "All-wheel drive", "Petrol"],
    priceNaira: 364_048_400, basis: "estimate", note: "arawheels.com approximate Nigerian price for a 2025 Huracán. A market estimate, not a dealer quote." },
];

export const carById = (id) => CARS.find((c) => c.id === id) ?? null;
/** Can this car be bought right now? Only with a verified price. */
export const forSale = (car) => !!car && Number.isSafeInteger(car.priceNaira) && car.priceNaira > 0;
/** The paint to use: the picked one if the showroom offers it, a fixed paint if the car has one, else the first. */
export const paintFor = (car, wanted) => car?.fixedPaint ?? (CAR_PAINTS.some((p) => p.id === wanted) ? wanted : CAR_PAINTS[0].id);
/** What the screen is told about a car (the price as kobo text, like every amount). */
export const publicCar = (car) => ({ id: car.id, name: car.name, year: car.year, condition: car.condition, body: car.body, shape: car.shape, specs: car.specs, fixedPaint: car.fixedPaint ?? null,
  priceKobo: forSale(car) ? (BigInt(car.priceNaira) * 100n).toString() : null, basis: car.basis, note: car.note });

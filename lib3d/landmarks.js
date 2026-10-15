// lib3d/landmarks.js
// Places on the stylised OAU map. SCHEMATIC: not to scale, positions approximate (see docs/MAP-ACCURACY.md).
// conf says how much we know about a place:
//   "name"      the name is a real OAU place (confirmed in public sources); its position on this map is approximate
//   "relative"  real place, placed using written directions from sources (which road it is on, what it is next to)
//   "schematic" a game placement; the real position is not known to this project
// osm: lowercase name fragments used to match real OpenStreetMap features when real map data is loaded.
// Coordinates: x east, z south, in map units.
const L = (id, name, kind, x, z, blurb, actions = [], conf = "schematic", osm = []) => ({ id, name, kind, x, z, blurb, actions, conf, verified: conf !== "schematic", osm: [name.toLowerCase(), ...osm] });
const COURSES = { label: "Your courses", href: "/courses" }, PARTIES = { label: "This week's parties", href: "/parties" }, PEOPLE = { label: "People and messages", href: "/people" };
const CAREER = { label: "Jobs and business", href: "/career" }, HOME = { label: "Rest and recover", href: "/play" };

export const LANDMARKS = [
  // main core (Road 1 runs from the main gate to Oduduwa Hall)
  L("oduduwa", "Oduduwa Hall", "hall", 0, -21, "The ceremonial heart of campus. Road 1 runs from the main gate all the way up to it.", [PARTIES], "name"),
  L("amphitheatre", "Amphitheatre", "hall", -27, -22, "Open-air tiered seating beside Oduduwa Hall. Big events and bigger crowds.", [PEOPLE], "name", ["amphitheater"]),
  L("library", "Hezekiah Oluwasanmi Library", "library", 25, -4, "Silence, deadlines and the best seats before exams. Found on Road 7.", [COURSES], "relative", ["oluwasanmi library"]),
  L("senate", "Senate Building", "hall", 0, 19, "Administration and results. Check how your session is going.", [COURSES], "schematic"),
  L("sub", "Student Union Building", "social", -25, 7, "Where everyone ends up between lectures.", [PEOPLE], "schematic", ["students' union", "student union"]),
  L("moremi_statue", "Moremi Statue", "statue", 0, -10, "A landmark for photos, meetings and 'meet me at the statue'.", [PEOPLE], "schematic", ["moremi statue", "moremi ajasoro"]),
  // faculties and colleges (game placements)
  L("f_science", "Faculty of Science", "faculty", -58, -14, "Labs, long practicals and Boroks' Mathematics.", [COURSES]),
  L("f_technology", "Faculty of Technology", "faculty", -58, 10, "Engineering drawings and sleepless nights.", [COURSES]),
  L("f_cs", "Faculty of Computer Science", "faculty", -34, -46, "Code, bugs and cold laptops.", [COURSES]),
  L("f_law", "Faculty of Law", "faculty", -6, -50, "Readings that never end. Road 5 runs from Oduduwa Hall past the Faculty of Law.", [COURSES], "relative"),
  L("f_arts", "Faculty of Arts", "faculty", 20, -50, "Books, debates and good arguments.", [COURSES]),
  L("f_education", "Faculty of Education", "faculty", 44, -44, "Future teachers and a lot of group work.", [COURSES]),
  L("f_pharmacy", "Faculty of Pharmacy", "faculty", 58, -22, "Chemistry, compounds and tough exams.", [COURSES]),
  L("f_health", "College of Health Sciences", "faculty", 68, -2, "Medicine, nursing and health sciences teaching. The teaching hospital itself is in town, not on campus.", [COURSES]),
  L("f_social", "Faculty of Social Sciences", "faculty", 56, 20, "Economics, psychology and politics.", [COURSES]),
  L("f_admin", "Faculty of Administration", "faculty", 30, 33, "Accounting, management and sharp suits.", [COURSES]),
  L("f_edm", "Environmental Design and Management", "faculty", -34, 30, "Studios, models and big drawings. The Architecture department is near Moremi Hall.", [COURSES], "relative", ["architecture"]),
  L("f_agric", "Faculty of Agriculture", "farm", -78, -44, "Crops, soil and early mornings on the farm.", [COURSES]),
  // halls of residence along the western road: Alumni, Health Centre, Awolowo, Postgraduate, Mozambique, Angola, then on to the staff quarters
  L("h_alumni", "Alumni Hall", "hostel", -46, 20, "The first hall on the road out west, close to the main core.", [HOME], "relative"),
  L("health_centre", "Health Centre", "hospital", -58, 32, "The campus health centre, on the road between Alumni Hall and Awolowo Hall.", [HOME], "relative", ["health center", "health centre"]),
  L("h_awo", "Awolowo Hall (Awo)", "hostel", -74, 36, "A famous men's hall. Loud, proud, never quiet.", [HOME], "relative", ["awolowo hall", "awo hall"]),
  L("h_pg", "Murtala Muhammed Postgraduate Hall", "hostel", -90, 24, "The postgraduate hall, in the western part of campus.", [HOME], "relative", ["postgraduate hall", "pg hall", "murtala"]),
  L("h_mozambique", "Mozambique Hall (Moz)", "hostel", -92, 46, "Next door to Angola Hall. Lively all night.", [HOME], "relative", ["mozambique hall"]),
  L("h_angola", "Angola Hall", "hostel", -108, 40, "Next door to Mozambique Hall, at the far end of the halls road.", [HOME], "relative", ["angola hall"]),
  L("h_moremi", "Moremi Hall", "hostel", -16, 44, "A women's hall near the Architecture department, on Moremi Road.", [HOME], "relative", ["moremi hall"]),
  // other halls: real names, positions unknown to this project
  L("h_fajuyi", "Fajuyi Hall", "hostel", 78, 28, "Men's hall with a big reputation.", [HOME], "name", ["fajuyi hall"]),
  L("h_etf", "ETF Hall", "hostel", 92, 44, "Newer men's rooms. The Education Trust Fund hall.", [HOME], "name", ["etf hall", "education trust fund"]),
  L("h_akintola", "Akintola Hall", "hostel", 96, 14, "Women's hall on the eastern side. Named for Ladoke Akintola.", [HOME], "name", ["akintola hall", "ladoke akintola"]),
  L("h_ojaja", "Ojaja", "hostel", 108, -14, "Private rooms for students with deeper pockets. Not one of the official halls.", [HOME]),
  // town and gate
  L("gate", "Main Gate", "gate", 0, 47, "The line between campus and town. Road 1 starts here.", [CAREER], "relative", ["main gate"]),
  L("ede_road", "Ede Road", "town", -60, 54, "The busy road along the south edge. Okada, keke and noise.", [CAREER], "name"),
  L("road1", "Road 1", "town", -78, 72, "Food, shops and hustle.", [CAREER]),
  L("damico", "Damico", "town", -34, 74, "Students everywhere, deals everywhere.", [CAREER], "name"),
  L("mayfair", "Mayfair", "town", 6, 70, "Busy by day, busier after dark.", [CAREER], "name"),
  L("asherifa", "Asherifa", "town", 48, 74, "Off-campus rooms and quiet corners.", [CAREER], "name"),
  L("sabo", "Sabo", "town", 86, 70, "A bustling market district.", [CAREER], "name"),
  L("parakin", "Parakin", "town", -96, 96, "Residential streets just off campus.", [CAREER], "name"),
  L("lagere", "Lagere", "town", 56, 98, "Town life, markets and long walks.", [CAREER], "name"),
  // nightlife (game placement)
  L("club_quantum", "Quantum", "club", -14, 86, "Big nights, big crowds.", [PARTIES]),
  L("club_0203", "0203", "club", 18, 88, "A student favourite after dark.", [PARTIES]),
  L("club_divas", "Royal Divas", "club", 36, 84, "Dress up. Show up.", [PARTIES]),
];

// Road centre-lines [x, z] and width. Named where the name is a real OAU road.
export const ROADS = [
  { w: 9, name: "Ede Road", pts: [[-118, 54], [118, 54]] },
  { w: 7, name: "Road 1 (Sir Adesoji Aderemi Road)", pts: [[0, 54], [0, 24]] },       // gate to the main core
  { w: 6, pts: [[-36, -27], [36, -27], [36, 25], [-36, 25], [-36, -27]] },             // ring road round the quadrangle
  { w: 6, name: "Halls road", pts: [[-36, 20], [-62, 20], [-62, 36], [-98, 36], [-98, 44]] }, // Alumni, Health Centre, Awolowo, Postgraduate, Mozambique, Angola
  { w: 5, pts: [[-62, 20], [-90, 20]] },
  { w: 6, name: "Moremi Road", pts: [[-16, 54], [-16, 44], [-34, 36]] },
  { w: 6, pts: [[36, 0], [64, 0], [64, 44], [100, 44]] },
  { w: 6, pts: [[64, 22], [100, 22]] }, { w: 5, pts: [[64, -14], [108, -14]] },
  { w: 6, name: "Road 5", pts: [[0, -27], [0, -58]] },                                 // Oduduwa Hall past the Faculty of Law
  { w: 5, pts: [[-70, -27], [-70, 0]] },
  { w: 6, pts: [[-100, 80], [110, 80]] }, { w: 6, pts: [[-40, 54], [-40, 100]] }, { w: 6, pts: [[28, 54], [28, 100]] },
];
export const SLAB = { x0: -122, x1: 122, z0: -72, z1: 112 };
export const kindOf = (id) => LANDMARKS.find((l) => l.id === id);
// Display helpers used by the map page, the place labels and campusData.js. Every kind used by LANDMARKS above must appear in all three.
export const ICON_OF = { hall: "hall", library: "library", faculty: "faculty", lecture: "faculty", admin: "hall", hospital: "hospital", farm: "farm", hostel: "hostel", block: "hostel", social: "social", statue: "statue", sports: "statue", worship: "hall", gate: "gate", parking: "gate", club: "club", jail: "siren", billboard: "billboard", building: "town", town: "town", bank: "town", shop: "town" };
export const KIND_LABEL = { hall: "Hall", library: "Library", faculty: "Faculty or department", lecture: "Lecture theatre or teaching building", admin: "Administration", hospital: "Health", farm: "Farm", hostel: "Hostel", block: "Hostel block", social: "Student life", statue: "Landmark", sports: "Sports", worship: "Place of worship", gate: "Gate", parking: "Parking", club: "Nightlife", jail: "Floor O", billboard: "Billboard", building: "Campus building", town: "Town", bank: "Bank", shop: "Shop or food" };
export const MAP_GROUPS = [["Campus core", ["hall", "library", "social", "admin", "statue"]], ["Faculties and teaching", ["faculty", "lecture", "hospital", "farm"]], ["Hostels", ["hostel", "block"]], ["Banks, shops and food", ["bank", "shop"]], ["Sports and worship", ["sports", "worship", "parking"]], ["Town and gate", ["gate", "town"]], ["Nightlife", ["club"]], ["Floor O", ["jail"]], ["Billboards", ["billboard"]]];
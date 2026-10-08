// lib3d/landmarks.js
// Places on the stylised OAU map. The map is SCHEMATIC: not to scale and positions are approximate.
// verified: true = the name was confirmed in public sources about OAU. Everything else comes from the game design and needs checking.
// Coordinates: x east, z south, in map units.
const L = (id, name, kind, x, z, blurb, actions = [], verified = false) => ({ id, name, kind, x, z, blurb, actions, verified });
const COURSES = { label: "Your courses", href: "/courses" }, PARTIES = { label: "This week's parties", href: "/parties" }, PEOPLE = { label: "People and messages", href: "/people" };
const CAREER = { label: "Jobs and business", href: "/career" }, HOME = { label: "Rest and recover", href: "/play" };

export const LANDMARKS = [
  // main core
  L("oduduwa", "Oduduwa Hall", "hall", 0, -21, "The ceremonial heart of campus, with a grand portico facing the quadrangle.", [PARTIES], true),
  L("amphitheatre", "Amphitheatre", "hall", -27, -22, "Open-air tiered seating beside Oduduwa Hall. Big events and bigger crowds.", [PEOPLE], true),
  L("library", "Hezekiah Oluwasanmi Library", "library", 25, -4, "Silence, deadlines and the best seats before exams.", [COURSES], true),
  L("senate", "Senate Building", "hall", 0, 19, "Administration and results. Check how your session is going.", [COURSES]),
  L("sub", "Student Union Building", "social", -25, 7, "Where everyone ends up between lectures.", [PEOPLE]),
  L("moremi_statue", "Moremi Statue", "statue", 0, -10, "A landmark for photos, meetings and 'meet me at the statue'.", [PEOPLE]),
  // faculties
  L("f_science", "Faculty of Science", "faculty", -58, -14, "Labs, long practicals and Boroks' Mathematics.", [COURSES]),
  L("f_technology", "Faculty of Technology", "faculty", -58, 10, "Engineering drawings and sleepless nights.", [COURSES]),
  L("f_cs", "Faculty of Computer Science", "faculty", -34, -46, "Code, bugs and cold laptops.", [COURSES]),
  L("f_law", "Faculty of Law", "faculty", -6, -50, "Readings that never end.", [COURSES]),
  L("f_arts", "Faculty of Arts", "faculty", 20, -50, "Books, debates and good arguments.", [COURSES]),
  L("f_education", "Faculty of Education", "faculty", 44, -44, "Future teachers and a lot of group work.", [COURSES]),
  L("f_pharmacy", "Faculty of Pharmacy", "faculty", 58, -22, "Chemistry, compounds and tough exams.", [COURSES]),
  L("f_health", "College of Health Sciences", "hospital", 68, 0, "Medicine, nursing and the teaching hospital life.", [COURSES]),
  L("f_social", "Faculty of Social Sciences", "faculty", 56, 20, "Economics, psychology and politics.", [COURSES]),
  L("f_admin", "Faculty of Administration", "faculty", 30, 33, "Accounting, management and sharp suits.", [COURSES]),
  L("f_edm", "Environmental Design and Management", "faculty", -32, 33, "Studios, models and big drawings.", [COURSES]),
  L("f_agric", "Faculty of Agriculture", "farm", -78, -44, "Crops, soil and early mornings on the farm.", [COURSES]),
  // male hostels
  L("h_awo", "Awolowo Hall (Awo)", "hostel", -72, 24, "A famous men's hall. Loud, proud, never quiet.", [HOME], true),
  L("h_fajuyi", "Fajuyi Hall", "hostel", -88, 11, "Men's hall with a big reputation.", [HOME], true),
  L("h_angola", "Angola Hall", "hostel", -92, 30, "Men's hall on the western side.", [HOME]),
  L("h_etf", "ETF Hostel", "hostel", -74, 43, "Newer men's rooms.", [HOME]),
  // female hostels
  L("h_moremi", "Moremi Hall", "hostel", 74, 26, "A women's hall with a long tradition.", [HOME], true),
  L("h_mozambique", "Mozambique Hall (Moz)", "hostel", 90, 13, "Women's hall, lively all night.", [HOME]),
  L("h_akintola", "Akintola Hall", "hostel", 92, 33, "Women's hall on the eastern side.", [HOME]),
  L("h_alumni", "Alumni Hall", "hostel", 76, 43, "Women's hall with newer rooms.", [HOME]),
  L("h_ojaja", "Ojaja", "hostel", 104, -10, "Premium rooms for students with deeper pockets.", [HOME]),
  // town
  L("gate", "Main Gate", "gate", 0, 47, "The line between campus and town.", [CAREER]),
  L("ede_road", "Ede Road", "town", -60, 54, "The busy road along the south edge. Okada, keke and noise.", [CAREER]),
  L("road1", "Road 1", "town", -78, 72, "Food, shops and hustle.", [CAREER]),
  L("damico", "Damico", "town", -34, 74, "Students everywhere, deals everywhere.", [CAREER]),
  L("mayfair", "Mayfair", "town", 6, 70, "Busy by day, busier after dark.", [CAREER]),
  L("asherifa", "Asherifa", "town", 48, 74, "Off-campus rooms and quiet corners.", [CAREER]),
  L("sabo", "Sabo", "town", 86, 70, "A bustling market district.", [CAREER]),
  L("parakin", "Parakin", "town", -96, 96, "Residential streets just off campus.", [CAREER]),
  L("lagere", "Lagere", "town", 56, 98, "Town life, markets and long walks.", [CAREER]),
  // nightlife (positions are game placement)
  L("club_quantum", "Quantum", "club", -14, 86, "Big nights, big crowds.", [PARTIES]),
  L("club_0203", "0203", "club", 18, 88, "A student favourite after dark.", [PARTIES]),
  L("club_divas", "Royal Divas", "club", 36, 84, "Dress up. Show up.", [PARTIES]),
];

// Road centre-lines [x, z] and width.
export const ROADS = [
  { w: 9, pts: [[-118, 54], [118, 54]] },                                  // Ede Road
  { w: 7, pts: [[0, 54], [0, 24]] },                                       // gate to the core
  { w: 6, pts: [[-36, -27], [36, -27], [36, 25], [-36, 25], [-36, -27]] }, // ring road round the quadrangle
  { w: 6, pts: [[-36, 0], [-62, 0], [-62, 40], [-96, 40]] },               // west to the men's halls
  { w: 6, pts: [[-62, 20], [-96, 20]] },
  { w: 6, pts: [[36, 0], [64, 0], [64, 44], [100, 44]] },                  // east to the women's halls
  { w: 6, pts: [[64, 22], [100, 22]] },
  { w: 6, pts: [[0, -27], [0, -58]] },                                     // north to the faculties
  { w: 5, pts: [[-70, -27], [-70, 0]] },
  { w: 6, pts: [[-100, 80], [110, 80]] },                                  // town street
  { w: 6, pts: [[-40, 54], [-40, 100]] }, { w: 6, pts: [[28, 54], [28, 100]] },
];
export const SLAB = { x0: -122, x1: 122, z0: -72, z1: 112 };
export const kindOf = (id) => LANDMARKS.find((l) => l.id === id);

'use strict';
/* ==========================================================================
   Content: what each actuator is, how it works, where it is used.
   Numbers are typical catalogue ranges, not limits.
   ========================================================================== */
const ROLE_LABEL = {
  input: 'Input', output: 'Output', fixed: 'Fixed', transfer: 'Transfer',
  elastic: 'Elastic', sensor: 'Sensor', fluid: 'Working fluid'
};

const GROUPS = [
  { id: 'foundations', label: 'Foundations', items: ['spur', 'bldc'] },
  { id: 'reducers', label: 'Speed reducers', items: ['planetary', 'harmonic', 'cycloidal', 'worm'] },
  { id: 'joints', label: 'Robot joint actuators', items: ['qdd', 'sea'] },
  { id: 'linear', label: 'Linear', items: ['screw'] },
  { id: 'fluid', label: 'Fluid power', items: ['cylinder'] },
];

const INFO = {
  spur: {
    name: 'Spur gear pair', kicker: 'Foundations', spec: '1–6:1 per stage',
    tagline: 'Two toothed wheels trade speed for torque at a fixed ratio set by their tooth counts.',
    legend: ['input', 'output', 'fixed', 'transfer'],
    plate: [['Ratio per stage', '1:1 – 6:1'], ['Backlash', '5–30 arcmin'], ['Efficiency', '95–98 %'], ['Backdrivable', 'Yes'], ['Shafts', 'Parallel'], ['Tooth form', 'Involute, 20°']],
    how: [
      'The motor turns the small gear, called the pinion. Its teeth push on the larger gear at the pitch point.',
      'Both gears behave like two discs rolling on their pitch circles without slipping, so their rim speeds match: ω₁·r₁ = ω₂·r₂.',
      'Pitch radius is proportional to tooth count, so speed drops by i = N₂/N₁ and torque rises by the same factor, minus 2–5 % lost to friction.',
      'The involute tooth shape keeps the contact force on one straight line, the line of action, tilted 20° from the tangent. That keeps the ratio constant while teeth roll through contact.',
      'Every external mesh reverses direction. Turn on Pitch to see the pitch circles, the pitch point and the line of action.'
    ],
    pros: ['Simple, cheap and easy to inspect', 'High efficiency per mesh', 'Backdrivable', 'Exact ratio from tooth counts'],
    cons: ['About 6:1 per stage before the pinion gets too small', 'Backlash unless preloaded or split', 'Noisy at speed (helical gears are quieter)', 'Only parallel shafts'],
    uses: [
      { field: 'Gearboxes and transmissions', ex: 'Industrial parallel-shaft reducers, manual car gearboxes (helical)', why: 'Robust and efficient for fixed or selectable ratios between parallel shafts.' },
      { field: 'Machine tools', ex: 'Lathe headstocks, feed gearboxes', why: 'Exact ratios link spindle speed to feed rate for cutting threads.' },
      { field: 'Hobby servos and toys', ex: 'RC servos stack 3–5 plastic or metal spur stages', why: 'Cheap way to reach 100:1 or more in a small box.' },
      { field: 'Clocks, meters, printers', ex: 'Watch trains, paper feed drives', why: 'Fixed timing ratios with low cost.' },
    ],
    choose: 'Shafts are parallel, the ratio is moderate, and cost matters.',
    avoid: 'You need more than about 10:1 in one stage, zero backlash, or quiet running at high speed.'
  },

  bldc: {
    name: 'Brushless motor', kicker: 'Foundations · outrunner, 12 slots / 14 poles', spec: 'τ = Kt·I',
    tagline: 'Electromagnets on a fixed stator pull a ring of permanent magnets around. It is the prime mover inside most electric actuators.',
    legend: ['input', 'output', 'fixed'],
    plate: [['Torque constant', 'Kt ≈ 9.55 / Kv'], ['Efficiency', '80–95 %'], ['Poles / slots', '14 / 12'], ['Pole pairs', '7'], ['Backlash', 'None, no gears'], ['Control', '3-phase FOC']],
    how: [
      'The stator holds 12 copper coils wound on laminated steel teeth. It never moves.',
      'The rotor bell carries 14 permanent magnets with alternating poles. Red faces are north, silver faces are south.',
      'A motor controller drives three sinusoidal phase currents, A, B and C, through the coils. Each energized coil becomes an electromagnet: it glows red when its face is north and white when it is south.',
      'The pattern of stator poles rotates and the magnets chase it. With 7 pole pairs, one mechanical turn takes 7 electrical cycles.',
      'Torque is proportional to current (τ = Kt·I) and no-load speed to voltage (n ≈ Kv·V). That linearity is what makes brushless motors easy to control precisely.'
    ],
    note: 'An outrunner puts the magnets outside the stator. The larger rotor radius gives more torque per amp than an inrunner of the same size.',
    pros: ['High efficiency, no brushes to wear', 'Torque follows current, so it is easy to control', 'High speed and power density', 'Silent and long-lived'],
    cons: ['Low torque at low speed for its mass, so most joints add a gearbox', 'Needs a controller and rotor position sensing', 'Winding heat limits continuous torque', 'Cogging torque without careful design'],
    uses: [
      { field: 'Drones and RC aircraft', ex: 'Outrunners like this one drive propellers directly', why: 'High speed and power per gram.' },
      { field: 'Robot joints', ex: 'Frameless motors inside QDD, harmonic and cycloidal actuators', why: 'Precise torque control and high efficiency.' },
      { field: 'E-bikes, scooters, EVs', ex: 'Hub motors; permanent-magnet traction motors', why: 'Efficient, high torque per amp, regenerative braking.' },
      { field: 'Fans, pumps, hard drives', ex: 'Spindle motors, cooling fans', why: 'Long life with no brush wear.' },
    ],
    choose: 'You want electric, efficient, controllable rotation.',
    avoid: 'You need high torque at standstill and cannot add a reducer or a large-diameter rotor.'
  },

  planetary: {
    name: 'Planetary gearset', kicker: 'Speed reducer · epicyclic', spec: '3–10:1 per stage',
    tagline: 'A sun gear, orbiting planets and an outer ring share the load in a compact package with input and output on the same axis.',
    legend: ['input', 'output', 'fixed', 'transfer'],
    plate: [['Ratio per stage', '3:1 – 10:1'], ['Backlash', '3–15 arcmin'], ['Efficiency', '≈ 97 % per stage'], ['Backdrivable', 'Yes at low ratio'], ['Torque density', 'High'], ['Shafts', 'Coaxial']],
    how: [
      'Three members share one axis: the sun gear in the middle, the ring gear outside, and the carrier that holds the planets.',
      'Hold one member still, drive a second and take output from the third. Use the Calculate tab to switch which member is fixed and watch the colours change.',
      'With the ring fixed, the sun drives the planets, which roll around inside the ring and drag the carrier along: i = 1 + R/S.',
      'The torque is shared across 3 to 5 planets, so each tooth carries only part of the load. That is where the high torque density comes from.',
      'Stages multiply. Two 7:1 stages give 49:1 in a short cylinder.'
    ],
    pros: ['Compact and coaxial', 'Load sharing gives high torque density', 'Efficient, about 97 % per stage', 'Several ratios from one set by changing the fixed member'],
    cons: ['Backlash adds up with each stage', 'More parts and tighter tolerances than spur gears', 'Ratio per stage is limited to about 10:1', 'Precision low-backlash versions are expensive'],
    uses: [
      { field: 'Servo gearheads', ex: '1–3 stage precision planetary heads on servo motors', why: 'Coaxial, efficient, and stiff enough for automation axes.' },
      { field: 'Power tools', ex: 'Cordless drills and drivers use 2–3 stages', why: 'Very high torque from a small fast motor in a cylindrical housing.' },
      { field: 'Wind turbines', ex: 'First stages of main gearboxes', why: 'Splits enormous rotor torque across several planets.' },
      { field: 'Automatic transmissions and hybrids', ex: 'Toyota hybrid power-split device', why: 'Clutches lock different members to give different ratios from one gear set.' },
      { field: 'Legged robots', ex: 'Single-stage 6–10:1 inside quasi-direct drives', why: 'Low ratio keeps the joint backdrivable.' },
    ],
    choose: 'You want a coaxial reducer from about 3:1 to 100:1 with good efficiency.',
    avoid: 'You need near-zero backlash at high ratio in a single stage. Strain wave or cycloidal drives do that better.'
  },

  harmonic: {
    name: 'Strain wave gear', kicker: 'Speed reducer · harmonic drive', spec: '30–160:1 single stage',
    tagline: 'An elliptical cam flexes a thin toothed cup so it walks around a rigid ring, two teeth per input turn.',
    legend: ['input', 'output', 'fixed', 'transfer'],
    plate: [['Ratio', '30:1 – 160:1'], ['Backlash', '≈ 0, under 1 arcmin'], ['Efficiency', '65–85 %'], ['Backdrivable', 'Poor at high ratio'], ['Torque density', 'Very high'], ['Teeth in mesh', '≈ 30 % at once']],
    how: [
      'The input is the wave generator: an elliptical plug with a thin, flexible ball bearing pressed onto it.',
      'It forces the flexspline, a thin steel cup with external teeth, into an ellipse. Its teeth engage the rigid circular spline only around the two ends of the long axis.',
      'The flexspline has 2 fewer teeth than the circular spline. Each time the ellipse turns once, the flexspline falls behind by 2 teeth.',
      'So i = N_f / (N_c − N_f). With 200 and 202 teeth that is 100:1 in one stage, and the output turns opposite to the input.',
      'Many teeth engage at once under preload, which gives almost zero backlash. The cup flexes twice per input turn, so it is designed against fatigue.'
    ],
    note: 'The deformation is drawn to scale: the radial flex equals one gear module, which is why it looks subtle. Pick 20:1 in Calculate to see it clearly.',
    pros: ['Very high ratio in one compact stage', 'Near-zero backlash', 'Light, flat, and can have a hollow shaft', 'High positional accuracy'],
    cons: ['Torsionally soft at low torque, so the joint winds up', 'Flexspline fatigue limits life and overload', 'Lower efficiency, especially when cold or lightly loaded', 'Poor backdrivability; can skip teeth (ratchet) under shock'],
    uses: [
      { field: 'Industrial robot wrists', ex: 'Axes 4–6 of six-axis arms', why: 'Small, light and precise where the arm is most sensitive to mass.' },
      { field: 'Collaborative robots', ex: 'Universal Robots, KUKA LBR iiwa joints', why: 'Compact, hollow-shaft joints with high accuracy.' },
      { field: 'Humanoid arms', ex: 'Tesla Optimus rotary actuators', why: 'High torque density in a flat package.' },
      { field: 'Space hardware', ex: 'Apollo Lunar Roving Vehicle wheel drives, rover arms, antenna pointing', why: 'Light, precise, and very high ratio per gram.' },
      { field: 'Semiconductor and optics', ex: 'Wafer handlers, telescope mounts', why: 'Zero backlash for repeatable positioning.' },
    ],
    choose: 'You need precision, compactness and a high ratio with no backlash.',
    avoid: 'The joint sees heavy impacts, must be backdrivable, or cost is tight.'
  },

  cycloidal: {
    name: 'Cycloidal drive', kicker: 'Speed reducer · cycloid / RV', spec: '10–100:1 single stage',
    tagline: 'A lobed disc wobbles around a ring of pins and turns backwards by one lobe per input revolution.',
    legend: ['input', 'output', 'fixed', 'transfer'],
    plate: [['Ratio', '10:1 – 100:1 (RV 30–200+)'], ['Backlash', 'Under 1 arcmin'], ['Efficiency', '80–93 %'], ['Backdrivable', 'Poor'], ['Shock tolerance', 'Very high'], ['Load sharing', '≈ ⅓ of lobes']],
    how: [
      'The input shaft carries an eccentric cam. It makes the cycloidal disc orbit around the axis.',
      'The disc has one lobe fewer than there are ring pins. As it orbits, each lobe rolls into the next gap between pins.',
      'After one input turn the disc has turned backwards by exactly one lobe: i = N_lobes = N_pins − 1.',
      'Output pins pass through holes in the disc that are larger by twice the eccentricity. They pick up only the slow rotation and cancel the wobble.',
      'Two discs set 180° apart balance the eccentric mass and share the load.'
    ],
    note: 'An RV reducer adds a planetary first stage that drives two or three crankshafts acting as the eccentric, which gives 30–200:1 with very high stiffness.',
    pros: ['Very high shock and overload capacity', 'Near-zero backlash and high stiffness', 'Rolling contact on many lobes gives long life', 'Compact for its torque'],
    cons: ['Precise, costly manufacturing', 'Vibration if the eccentric mass is not balanced', 'Heavier than a strain wave gear of similar torque', 'Not backdrivable at high ratio'],
    uses: [
      { field: 'Industrial robot base, shoulder and elbow', ex: 'Nabtesco RV reducers in FANUC, KUKA, ABB and Yaskawa arms', why: 'Carries large moments and emergency-stop shocks with high stiffness.' },
      { field: 'Machine tools', ex: 'Rotary tables, tool-changer magazines', why: 'Stiff, accurate indexing under cutting loads.' },
      { field: 'Positioners and turntables', ex: 'Welding positioners, heavy indexers', why: 'High torque with zero backlash.' },
      { field: 'Heavy industrial drives', ex: 'Conveyors, mixers, extruders', why: 'Survives repeated shock loads.' },
    ],
    choose: 'The joint carries big loads and shocks and still needs precision.',
    avoid: 'You need a light, backdrivable or very cheap joint.'
  },

  worm: {
    name: 'Worm drive', kicker: 'Speed reducer · crossed axes', spec: '5–100:1 single stage',
    tagline: 'A screw-like worm turns a gear one tooth per revolution and can lock itself against back-driving.',
    legend: ['input', 'output', 'fixed'],
    plate: [['Ratio', '5:1 – 100:1'], ['Efficiency', '30–90 %, falls with ratio'], ['Backlash', '10–60 arcmin'], ['Self-locking', 'At small lead angles'], ['Shafts', 'At 90°'], ['Noise', 'Very quiet']],
    how: [
      'The worm is a screw. Each turn advances its thread by one lead and pushes the wheel along by that many teeth.',
      'A single-start worm moves the wheel by one tooth per revolution, so i = N_wheel / starts.',
      'The thread slides across the teeth instead of rolling, so friction matters. Efficiency depends on the lead angle λ and the friction coefficient μ.',
      'If λ is smaller than the friction angle (atan μ), the wheel cannot turn the worm backwards. The drive holds its load without a brake.'
    ],
    note: 'Self-locking is not a reliable safety brake: vibration can let a worm creep. Lifting equipment still uses a separate brake.',
    pros: ['Large ratio in one compact stage', 'Right-angle output', 'Quiet and smooth', 'Can self-lock'],
    cons: ['Low efficiency, so it runs hot', 'Wheel wears (usually bronze)', 'Backlash in standard grades', 'Self-locking depends on friction and vibration'],
    uses: [
      { field: 'Hoists, lifts and gates', ex: 'Garage door openers, barrier arms, small winches', why: 'Holds the load when power is off.' },
      { field: 'Conveyors and mixers', ex: 'Right-angle gear motors', why: 'Compact high ratio at 90°.' },
      { field: 'Instruments', ex: 'Guitar tuning pegs, telescope slow-motion drives', why: 'Fine adjustment that stays put.' },
      { field: 'Positioning', ex: 'Solar trackers, valve actuators, indexing tables', why: 'Holds position against wind or pressure.' },
    ],
    choose: 'You want a big ratio at a right angle and the load should hold when power is off.',
    avoid: 'Efficiency, backdrivability or heat matter, as in robot joints and battery devices.'
  },

  qdd: {
    name: 'Quasi-direct drive', kicker: 'Robot joint actuator · QDD', spec: '6–10:1, backdrivable',
    tagline: 'A large, flat torque motor with a single low-ratio planetary stage. Strong, yet easy to push back by hand.',
    legend: ['input', 'output', 'fixed', 'transfer', 'sensor'],
    plate: [['Ratio', '6:1 – 10:1'], ['Backdrivable', 'Excellent'], ['Efficiency', '85–95 %'], ['Reflected inertia', 'Low, ∝ i²'], ['Torque sensing', 'From motor current'], ['Impact tolerance', 'High']],
    how: [
      'A large-diameter outrunner makes high torque, because motor torque grows with rotor radius (roughly with r²·L).',
      'The rotor drives the sun of a single planetary stage nested inside the stator. The ring is part of the housing, and the carrier is the output flange.',
      'With only 6–10:1, friction and rotor inertia reflected to the output stay small, so a hand, or a foot hitting the ground, can back-drive the joint.',
      'Because the gearing is transparent, output torque can be estimated from motor current: τ_out ≈ Kt·I·i·η. No torque sensor is needed.',
      'This allows fast force control, which legged robots rely on to absorb landings, jump and balance.'
    ],
    pros: ['Backdrivable and impact tolerant', 'Torque estimated from current (proprioception)', 'High control bandwidth', 'Simpler than adding a spring and torque sensor'],
    cons: ['Lower torque density than high-ratio drives, so motors get big', 'Holding a static load costs current and heat', 'Current-based torque estimate is noisier than a load cell', 'Large diameter'],
    uses: [
      { field: 'Quadruped robots', ex: 'MIT Mini Cheetah (6:1), Unitree Go and B series', why: 'Survives landings and enables dynamic gaits.' },
      { field: 'Humanoid legs', ex: 'Unitree H1 and G1, many research humanoids', why: 'Transparent joints for balance and contact.' },
      { field: 'Exoskeletons', ex: 'Hip and knee assist devices', why: 'The wearer can move freely when assistance is off.' },
      { field: 'Haptics and teleoperation', ex: 'Force-feedback masters', why: 'Low friction and inertia let the user feel forces.' },
    ],
    choose: 'Contact and impacts matter: legs, interaction, force control.',
    avoid: 'The joint holds heavy static loads for long periods or must be very compact for its torque.'
  },

  sea: {
    name: 'Series elastic actuator', kicker: 'Robot joint actuator · SEA', spec: 'τ = k·Δθ',
    tagline: 'A deliberate spring between gearbox and load turns force control into a position measurement.',
    legend: ['input', 'output', 'fixed', 'elastic', 'sensor'],
    plate: [['Torque sensing', 'τ = k·Δθ'], ['Spring', 'Tunable, soft ↔ stiff'], ['Backdrivable', 'Through control'], ['Impact tolerance', 'Very high'], ['Bandwidth', 'Limited by spring'], ['Energy storage', 'Yes']],
    how: [
      'A motor and a high-ratio reducer (here a 50:1 strain wave gear) drive the inner hub of a torsion spring.',
      'The outer ring of the spring is the output. Load torque twists the spring by Δθ = τ / k.',
      'Two encoders measure the hub angle and the output angle. Their difference gives torque directly: τ = k·(θ_hub − θ_out).',
      'A controller moves the motor to hold the desired twist. That gives clean force control even through a stiff, high-friction gearbox.',
      'The spring also absorbs impacts before they reach the gear teeth, and it can store and return energy during walking.'
    ],
    note: 'Watch the violet spokes: the arm swings a payload, gravity and inertia load the spring, and the twist is the torque reading.',
    pros: ['Accurate, low-noise torque sensing', 'Protects the gearbox from shocks', 'Stores and returns energy', 'Safe physical interaction'],
    cons: ['Lower position bandwidth from the spring–mass resonance', 'Larger and more complex', 'Stiffness is a fixed trade-off unless variable', 'Needs a second encoder'],
    uses: [
      { field: 'Legged robots', ex: 'ANYbotics ANYmal (ANYdrive joints)', why: 'Robust torque control on rough terrain.' },
      { field: 'Collaborative robots', ex: 'Rethink Robotics Baxter and Sawyer', why: 'Compliant, safe arms around people.' },
      { field: 'Humanoids', ex: 'NASA Valkyrie', why: 'Torque-controlled whole-body motion.' },
      { field: 'Rehabilitation and prosthetics', ex: 'Exoskeleton joints, powered ankles', why: 'Gentle, accurate force on the human body.' },
    ],
    choose: 'Precise force control and shock protection matter more than stiffness.',
    avoid: 'You need fast, stiff position control, as in machining or pick-and-place.'
  },

  screw: {
    name: 'Ball and roller screws', kicker: 'Linear actuator · rotary to linear', spec: 'F = 2πηT / L',
    tagline: 'A threaded shaft and nut turn motor rotation into precise straight-line motion and force.',
    legend: ['input', 'output', 'fixed', 'transfer'],
    plate: [['Lead', '2–50 mm per rev'], ['Efficiency', 'Ball ≈ 90 %, lead screw 20–50 %'], ['Backlash', '≈ 0 with preload'], ['Backdrivable', 'Ball yes, lead screw often no'], ['Accuracy', 'Micron-level (ground)'], ['Load capacity', 'Roller > ball > lead']],
    how: [
      'The motor turns the screw. The nut is fixed to a carriage on rails, so it cannot spin and must travel along the thread instead.',
      'One revolution moves the nut by one lead L, so linear speed is v = n·L.',
      'Energy balance gives the force: F = 2π·η·T / L. A shorter lead gives more force and less speed, like a higher gear ratio.',
      'In a ball screw, steel balls roll between screw and nut grooves and recirculate through the return tube. Rolling instead of sliding gives about 90 % efficiency.',
      'A planetary roller screw replaces the balls with threaded rollers. Many more contact points carry several times the load in the same size.'
    ],
    pros: ['Precise, stiff linear motion', 'High efficiency (ball and roller)', 'Zero backlash with preloaded nuts', 'Electric: clean, quiet and easy to control'],
    cons: ['Ball screws backdrive, so vertical axes need a brake', 'Long screws whip at high speed (critical speed)', 'Sensitive to dirt and side loads', 'Roller screws are expensive'],
    uses: [
      { field: 'CNC machine tools', ex: 'Ground ball screws on X, Y, Z axes', why: 'Micron accuracy with high stiffness.' },
      { field: 'Electric presses and injection molding', ex: 'Servo presses, all-electric molding machines', why: 'Replaces hydraulics with cleaner, more efficient motion.' },
      { field: 'Humanoid robots', ex: 'Tesla Optimus linear actuators use planetary roller screws', why: 'Very high force in a slim package for knees, hips and elbows.' },
      { field: 'Aerospace', ex: 'Electromechanical flight-control and landing-gear actuators', why: 'Removes hydraulic lines for more-electric aircraft.' },
      { field: '3D printers and lab automation', ex: 'Lead screws on Z axes', why: 'Cheap and self-locking, so the axis holds when unpowered.' },
    ],
    choose: 'You need accurate straight-line motion with electric control.',
    avoid: 'Strokes are very long and fast (use belts or linear motors), or loads are huge and shock-heavy (hydraulics).'
  },

  cylinder: {
    name: 'Hydraulic and pneumatic cylinders', kicker: 'Fluid power · linear', spec: 'F = p·A',
    tagline: 'Pressurized fluid pushes a piston. Force is simply pressure times area.',
    legend: ['output', 'fixed', 'fluid'],
    plate: [['Pressure', 'Hydraulic 100–350 bar'], ['', 'Pneumatic 4–8 bar'], ['Force density', 'Very high (hydraulic)'], ['System efficiency', '40–70 % hydraulic'], ['Stiffness', 'Oil stiff, air springy'], ['Speed', 'v = Q / A']],
    how: [
      'A pump (or a compressor) sends fluid through a directional valve into one side of the cylinder.',
      'Pressure acts on the piston: F = p·A. At 210 bar, a 63 mm bore pushes about 65 kN, roughly 6.5 tonnes.',
      'Fluid on the other side returns to the tank, or for air, vents through the valve.',
      'On the return stroke, pressure acts on the smaller ring area between bore and rod. The cylinder pulls with less force but moves faster for the same flow. Watch the retract stroke run quicker.',
      'Oil barely compresses, so hydraulic cylinders hold position stiffly. Air compresses, which makes pneumatics springy and hard to stop mid-stroke.'
    ],
    pros: ['Enormous force from a compact cylinder (hydraulic)', 'Holds load with valves closed', 'Simple, cheap and fast (pneumatic)', 'Naturally compliant (pneumatic)'],
    cons: ['Pumps, hoses and leaks (hydraulic)', 'Poor energy efficiency', 'Pneumatic positioning is imprecise', 'Noise and maintenance'],
    uses: [
      { field: 'Construction and mining', ex: 'Excavator booms, dozer blades, loaders', why: 'Highest force per kilogram at the tool.' },
      { field: 'Presses and forming', ex: 'Hydraulic presses, forging, injection molding', why: 'Constant, controllable force through the whole stroke.' },
      { field: 'Aircraft', ex: 'Landing gear, flight-control actuators', why: 'Power-dense and proven redundant.' },
      { field: 'Robotics', ex: 'Boston Dynamics hydraulic Atlas (retired 2024 for an electric version)', why: 'Very high power density for dynamic motion.' },
      { field: 'Factory automation (pneumatic)', ex: 'Pick-and-place, grippers, packaging lines, bus doors', why: 'Cheap, fast end-to-end motion.' },
    ],
    choose: 'You need very large forces (hydraulic) or cheap, fast two-position motion (pneumatic).',
    avoid: 'You need clean, quiet, efficient and precise motion. Use electric screws instead.'
  },
};

/* Comparison: relative ratings 1–5 (higher = more of the quality; for cost, higher = more expensive). */
const COMPARE = [
  { id: 'spur', name: 'Spur gears', ratio: '1–6 / stage', backlash: '5–30′', eff: '95–98 %', back: 'Yes', td: 2, shock: 3, prec: 2, cost: 1, where: 'Gearboxes, servos, machines' },
  { id: 'planetary', name: 'Planetary', ratio: '3–10 / stage', backlash: '3–15′', eff: '≈97 % / stage', back: 'Yes, low ratio', td: 4, shock: 3, prec: 3, cost: 2, where: 'Servo heads, drills, turbines' },
  { id: 'harmonic', name: 'Strain wave', ratio: '30–160', backlash: '< 1′', eff: '65–85 %', back: 'Poor', td: 5, shock: 2, prec: 5, cost: 4, where: 'Robot wrists, cobots, space' },
  { id: 'cycloidal', name: 'Cycloidal / RV', ratio: '10–200', backlash: '< 1′', eff: '80–93 %', back: 'Poor', td: 4, shock: 5, prec: 5, cost: 4, where: 'Robot bases, rotary tables' },
  { id: 'worm', name: 'Worm', ratio: '5–100', backlash: '10–60′', eff: '30–90 %', back: 'Often self-locks', td: 2, shock: 3, prec: 2, cost: 1, where: 'Hoists, gates, conveyors' },
  { id: 'qdd', name: 'Quasi-direct drive', ratio: '6–10', backlash: '5–15′', eff: '85–95 %', back: 'Excellent', td: 3, shock: 5, prec: 3, cost: 2, where: 'Legged robots, exos' },
  { id: 'sea', name: 'Series elastic', ratio: '50–160 + spring', backlash: 'Compliant', eff: '60–85 %', back: 'Via control', td: 2, shock: 5, prec: 3, cost: 4, where: 'ANYmal, Baxter, Valkyrie' },
  { id: 'screw', name: 'Ball / roller screw', ratio: 'Lead 2–50 mm', backlash: '≈ 0 (preload)', eff: '85–92 %', back: 'Yes (ball)', td: 4, shock: 3, prec: 5, cost: 3, where: 'CNC, presses, humanoids' },
  { id: 'cylinder', name: 'Hydraulic cylinder', ratio: 'p × A', backlash: '—', eff: '40–70 % sys.', back: 'Holds with valves', td: 5, shock: 4, prec: 3, cost: 4, where: 'Excavators, presses, aircraft' },
  { id: 'cylinder', name: 'Pneumatic cylinder', ratio: 'p × A', backlash: '—', eff: '10–25 % sys.', back: 'Compliant', td: 2, shock: 4, prec: 1, cost: 1, where: 'Pick-and-place, grippers' },
  { id: 'bldc', name: 'Direct-drive motor', ratio: '1', backlash: '0', eff: '85–95 %', back: 'Perfect', td: 1, shock: 4, prec: 4, cost: 3, where: 'Gimbals, turntables, drones' },
];

/* Ratio bands for the trade-off chart (typical single-stage or class ranges). */
const BANDS = [
  { label: 'Direct drive', lo: 1, hi: 1.25, id: 'bldc' },
  { label: 'Quasi-direct drive', lo: 6, hi: 10, id: 'qdd' },
  { label: 'Planetary, 1 stage', lo: 3, hi: 10, id: 'planetary' },
  { label: 'Planetary, 2–3 stages', lo: 10, hi: 300, id: 'planetary' },
  { label: 'Worm', lo: 5, hi: 100, id: 'worm' },
  { label: 'Strain wave', lo: 30, hi: 160, id: 'harmonic' },
  { label: 'Cycloidal / RV', lo: 30, hi: 200, id: 'cycloidal' },
];

const GUIDE = [
  { need: 'A leg that lands, jumps and feels the ground', pick: 'Quasi-direct drive', id: 'qdd', why: 'Low reflected inertia and current-based torque sensing.' },
  { need: 'Precise, compact wrist joint with no backlash', pick: 'Strain wave gear', id: 'harmonic', why: '100:1 in a flat package with near-zero backlash.' },
  { need: 'Heavy robot base joint that survives e-stops', pick: 'Cycloidal / RV reducer', id: 'cycloidal', why: 'Stiff, rolling contact on many lobes, high shock rating.' },
  { need: 'Safe force control around people', pick: 'Series elastic actuator', id: 'sea', why: 'Spring twist is a clean torque measurement and a shock buffer.' },
  { need: 'Accurate straight-line motion, electric', pick: 'Ball or roller screw', id: 'screw', why: 'High efficiency and micron-level positioning.' },
  { need: 'Tens of tonnes of force', pick: 'Hydraulic cylinder', id: 'cylinder', why: 'Pressure × area scales force cheaply.' },
  { need: 'Holds the load when power is off', pick: 'Worm drive or lead screw', id: 'worm', why: 'Self-locking when the lead angle is below the friction angle.' },
  { need: 'Cheap coaxial reduction for a servo or drill', pick: 'Planetary gearset', id: 'planetary', why: 'Efficient, compact and easy to stack.' },
];

const GLOSSARY = [
  { term: 'Torque', f: 'τ = F × r   [N·m]', d: 'The turning effect of a force. 10 N pushing on a 0.1 m lever makes 1 N·m. Gears and screws trade torque against speed.', see: ['spur'] },
  { term: 'Gear ratio', f: 'i = N_out / N_in = ω_in / ω_out', d: 'How many input turns produce one output turn. Output torque rises by the same factor, less friction: τ_out = τ_in · i · η.', see: ['spur', 'planetary'] },
  { term: 'Power and efficiency', f: 'P = τ·ω     P_out = η·P_in', d: 'A reducer cannot create power. Whatever torque it gains it pays for in speed, and some power turns into heat.', see: ['spur', 'worm'] },
  { term: 'Module and pitch circle', f: 'd = m·N     a = m(N₁ + N₂) / 2', d: 'The module m sets tooth size. Gears only mesh if their modules match. The pitch circles are the imaginary rolling discs; a is the center distance.', see: ['spur'] },
  { term: 'Pressure angle, line of action', f: 'α = 20° (standard)', d: 'Tooth force acts along a fixed line tilted by α from the pitch tangent. The involute profile keeps it fixed, so the ratio stays constant through contact.', see: ['spur'] },
  { term: 'Backlash', f: '1 arcmin = 1/60°', d: 'Free play between mating teeth. The output can wobble by this much when torque reverses, which hurts precision in robot joints.', see: ['harmonic', 'cycloidal'] },
  { term: 'Backdrivability', f: 'η_back > 0 ?', d: 'Whether pushing the output can turn the motor. Low ratios, rolling contact and high efficiency make a drive backdrivable; worms and lead screws often are not.', see: ['qdd', 'worm'] },
  { term: 'Reflected inertia', f: 'J_out = J_rotor · i²', d: 'The motor rotor seems i² times heavier at the output. A 100:1 drive makes a light rotor feel enormous during impacts, which is why legged robots use 6–10:1.', see: ['qdd'] },
  { term: 'Proprioceptive torque sensing', f: 'τ_out ≈ Kt · I · i · η', d: 'Estimating output torque from motor current. It only works when the gearing is transparent: low ratio and low friction.', see: ['qdd'] },
  { term: 'Torsional stiffness', f: 'k = τ / Δθ   [N·m/rad]', d: 'How much a drive twists under load. Stiff joints position accurately; a deliberately soft spring makes a force sensor.', see: ['sea', 'harmonic'] },
  { term: 'Lead angle and self-locking', f: 'η = tan λ / tan(λ + φ),   φ = atan μ', d: 'For worms and screws, a small lead angle λ means high friction losses. If λ < φ, the load cannot drive the input backwards.', see: ['worm', 'screw'] },
  { term: 'Kv and Kt', f: 'Kt ≈ 9.55 / Kv   [N·m/A, Kv in rpm/V]', d: 'A motor with low Kv spins slowly per volt but gives more torque per amp. Same physics, two views.', see: ['bldc'] },
  { term: 'Lead (screws)', f: 'v = n·L     F = 2π·η·T / L', d: 'Travel per screw revolution. It plays the role of a gear ratio between rotation and translation.', see: ['screw'] },
  { term: 'Pressure × area', f: 'F = p·A     1 bar = 0.1 N/mm²', d: 'Fluid power force. Double the bore diameter and force goes up four times.', see: ['cylinder'] },
  { term: 'Torque density', f: '[N·m / kg]', d: 'Peak or continuous output torque per kilogram of actuator. High-ratio reducers win here; direct drives lose.', see: ['harmonic', 'qdd'] },
  { term: 'Bandwidth', f: 'f_n ≈ (1/2π)·√(k / J)', d: 'How quickly an actuator follows a changing command. Inertia, compliance and the control loop all limit it.', see: ['sea'] },
];

var languages = require('./languages');
var instructions = languages.instructions;

module.exports = function(version, _options) {
    var options = {};
    options.hooks = {};
    options.hooks.tokenizedInstruction = ((_options || {}).hooks || {}).tokenizedInstruction;

    Object.keys(instructions).forEach(function(code) {
        if (!instructions[code][version]) { throw 'invalid version ' + version + ': ' + code + ' not supported'; }
    });

    return {
        capitalizeFirstLetter: function(string) {
            return string.charAt(0).toUpperCase() + string.slice(1);
        },
        ordinalize: function(language, number) {
            // Transform numbers to their translated ordinalized value
            if (!language) throw new Error('No language code provided');

            return instructions[language][version].constants.ordinalize[number.toString()] || '';
        },
        directionFromDegree: function(language, degree) {
            // Transform degrees to their translated compass direction
            if (!language) throw new Error('No language code provided');
            if (!degree && degree !== 0) {
                // step had no bearing_after degree, ignoring
                return '';
            } else if (degree >= 0 && degree <= 20) {
                return instructions[language][version].constants.direction.north;
            } else if (degree > 20 && degree < 70) {
                return instructions[language][version].constants.direction.northeast;
            } else if (degree >= 70 && degree <= 110) {
                return instructions[language][version].constants.direction.east;
            } else if (degree > 110 && degree < 160) {
                return instructions[language][version].constants.direction.southeast;
            } else if (degree >= 160 && degree <= 200) {
                return instructions[language][version].constants.direction.south;
            } else if (degree > 200 && degree < 250) {
                return instructions[language][version].constants.direction.southwest;
            } else if (degree >= 250 && degree <= 290) {
                return instructions[language][version].constants.direction.west;
            } else if (degree > 290 && degree < 340) {
                return instructions[language][version].constants.direction.northwest;
            } else if (degree >= 340 && degree <= 360) {
                return instructions[language][version].constants.direction.north;
            } else {
                throw new Error('Degree ' + degree + ' invalid');
            }
        },
        laneConfig: function(step) {
            // Reduce any lane combination down to a contracted lane diagram
            if (!step.intersections || !step.intersections[0].lanes) throw new Error('No lanes object');

            var config = [];
            var currentLaneValidity = null;

            step.intersections[0].lanes.forEach(function (lane) {
                if (currentLaneValidity === null || currentLaneValidity !== lane.valid) {
                    if (lane.valid) {
                        config.push('o');
                    } else {
                        config.push('x');
                    }
                    currentLaneValidity = lane.valid;
                }
            });

            return config.join('');
        },
        compile: function(language, step, legIndex, legCount) {
            if (!language) throw new Error('No language code provided');
            if (languages.supportedCodes.indexOf(language) === -1) throw new Error('language code ' + language + ' not loaded');
            if (!step.maneuver) throw new Error('No step maneuver provided');
            if (arguments.length === 3) throw new Error('Either 2 or 4 arguments are required');

            var type = step.maneuver.type;
            var modifier = step.maneuver.modifier;
            var mode = step.mode;

            if (!type) { throw new Error('Missing step maneuver type'); }
            if (type !== 'depart' && type !== 'arrive' && !modifier) { throw new Error('Missing step maneuver modifier'); }

            if (!instructions[language][version][type]) {
                // Log for debugging
                console.log('Encountered unknown instruction type: ' + type); // eslint-disable-line no-console
                // OSRM specification assumes turn types can be added without
                // major version changes. Unknown types are to be treated as
                // type `turn` by clients
                type = 'turn';
            }

            // Use special instructions if available, otherwise `defaultinstruction`
            var instructionObject;
            if (instructions[language][version].modes[mode]) {
                instructionObject = instructions[language][version].modes[mode];
            } else if (instructions[language][version][type][modifier]) {
                instructionObject = instructions[language][version][type][modifier];
            } else {
                instructionObject = instructions[language][version][type].default;
            }

            // Special case handling
            var laneInstruction;
            switch (type) {
            case 'use lane':
                laneInstruction = instructions[language][version].constants.lanes[this.laneConfig(step)];

                if (!laneInstruction) {
                    // If the lane combination is not found, default to continue straight
                    instructionObject = instructions[language][version]['use lane'].no_lanes;
                }
                break;
            case 'rotary':
            case 'roundabout':
                if (step.rotary_name && step.maneuver.exit && instructionObject.name_exit) {
                    instructionObject = instructionObject.name_exit;
                } else if (step.rotary_name && instructionObject.name) {
                    instructionObject = instructionObject.name;
                } else if (step.maneuver.exit && instructionObject.exit) {
                    instructionObject = instructionObject.exit;
                } else {
                    instructionObject = instructionObject.default;
                }
                break;
            default:
                // NOOP, since no special logic for that type
            }

            // Decide way_name with special handling for name and ref
            var wayName;
            var name = step.name || '';
            var ref = (step.ref || '').split(';')[0];

            // Remove hacks from Mapbox Directions mixing ref into name
            if (name === step.ref) {
                // if both are the same we assume that there used to be an empty name, with the ref being filled in for it
                // we only need to retain the ref then
                name = '';
            }
            name = name.replace(' (' + step.ref + ')', '');

            if (name && ref && name !== ref) {
                wayName = name + ' (' + ref + ')';
            } else if (!name && ref) {
                wayName = ref;
            } else {
                wayName = name;
            }

            // Decide which instruction string to use
            // Destination takes precedence over name
            var instruction;
            if (step.destinations && instructionObject.destination) {
                instruction = instructionObject.destination;
            } else if (wayName && instructionObject.name) {
                instruction = instructionObject.name;
            } else {
                instruction = instructionObject.default;
            }

            if (options.hooks.tokenizedInstruction) {
                instruction = options.hooks.tokenizedInstruction(instruction);
            }

            var waypoint = legIndex >= 0 && legIndex !== legCount - 1 ? this.ordinalize(language, legIndex + 1) : '';

            // Replace tokens
            // NOOP if they don't exist
            instruction = instruction
                .replace('{way_name}', wayName)
                .replace('{destination}', (step.destinations || '').split(',')[0])
                .replace('{exit_number}', this.ordinalize(language, step.maneuver.exit || 1))
                .replace('{rotary_name}', step.rotary_name)
                .replace('{lane_instruction}', laneInstruction)
                .replace('{modifier}', instructions[language][version].constants.modifier[modifier])
                .replace('{direction}', this.directionFromDegree(language, step.maneuver.bearing_after))
                .replace('{nth}', waypoint)
                .replace(/ {2}/g, ' '); // remove excess spaces

            if (instructions[language].meta.capitalizeFirstLetter) {
                instruction = this.capitalizeFirstLetter(instruction);
            }

            return instruction;
        }
    };
};

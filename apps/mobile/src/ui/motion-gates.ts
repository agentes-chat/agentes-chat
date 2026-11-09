/**
 * Motion that is written but not yet seen running smoothly on a phone stays off. Each piece is turned on alone, after
 * it was watched on a device: a transition that stutters or lands in the wrong place is worse than a plain one.
 *
 * - `faceTravel`: an agent's face flying between its row, the conversation's header and its profile's cover.
 * - `askFold`: a decided request folding into its line inside the conversation.
 * - `agentBirth`: the full-screen scene of a new agent coming to be.
 */
export const MOTION_GATES = { faceTravel: false, askFold: false, agentBirth: false } as const;

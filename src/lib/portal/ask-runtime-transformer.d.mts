export function stripExports(src: string): string;
export function findForbiddenTokens(assembled: string): string[];
export function assembleFromSources(
  askIntentsSrc: string,
  propertyBrainSrc: string,
  askLogicSrc: string,
): string;

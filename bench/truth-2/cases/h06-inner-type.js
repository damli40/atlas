// Containers whose CONTENTS are not JSON: the container's own type is still array / object.
export function bigInList() { return [1n]; }
export function nanInList() { return [1, NaN]; }
export function undefinedInObject() { return { a: undefined }; }
export function dateInObject() { return { when: new Date(0) }; }

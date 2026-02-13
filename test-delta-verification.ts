// Test file for Phase 33 delta reporting verification

export function processUserData(data: any) {
  // TODO: Add input validation
  const result = eval(data.code); // Security issue: eval usage

  // Unused variable
  const unused = "this will be flagged";

  // Hardcoded credential
  const apiKey = "sk-1234567890abcdef";

  return result;
}

export function calculateTotal(items: any[]) {
  let total = 0;
  for (let i = 0; i < items.length; i++) {
    total += items[i].price;
  }
  // Missing null check on items
  return total;
}

// Empty function
export function handleError() {
  // Empty implementation
}

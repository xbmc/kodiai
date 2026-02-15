// Test file for Phase 33 delta reporting verification

export function processUserData(data: any) {
  // Fixed: removed eval, added proper validation
  if (!data || typeof data.code !== 'string') {
    throw new Error('Invalid input');
  }

  // Fixed: removed hardcoded credential
  const apiKey = process.env.API_KEY || '';

  return data.code;
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

// NEW: SQL injection vulnerability
export async function getUserByName(db: any, userName: string) {
  // SQL injection vulnerability - concatenating user input directly
  const query = `SELECT * FROM users WHERE name = '${userName}'`;
  return await db.query(query);
}

// NEW: Command injection vulnerability
export function runCommand(userInput: string) {
  const { execSync } = require('child_process');
  // Command injection - executing user input directly
  return execSync(`ls ${userInput}`).toString();
}

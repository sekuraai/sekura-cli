// The eighteen tools the Sekura MCP server lists (sekura-www, src/mcp/tools.ts,
// generated from src/connector/registry.ts), in their pairs. The skill must
// name every one and no other; skill.test.mjs holds it to this list, and to
// the live server's tools/list when SEKURA_TOOLS_LIST_URL is set.

export const READ = ['getAccount', 'listRepositories', 'listScans', 'getScan', 'getScanFindings', 'getReportLink', 'getPlans', 'getBilling']
export const QUOTE_CONFIRM = [['quoteScan', 'startScan'], ['quoteAlways', 'startAlways']]
export const PREVIEW_ACT = [['previewCancelScan', 'cancelScan'], ['previewCancelPlan', 'cancelPlan']]
export const ONE_CALL = ['updateSchedule', 'runNow']

export const TOOL_NAMES = [...READ, ...QUOTE_CONFIRM.flat(), ...PREVIEW_ACT.flat(), ...ONE_CALL]

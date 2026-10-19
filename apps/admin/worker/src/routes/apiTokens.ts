// Feature D (spec 07): API tokens for agents (list, create, revoke). The MCP endpoint itself
// (POST MCP_PATH, Bearer auth) goes in its own routes/mcp.ts. STUB: every endpoint is guarded and
// answers 404 until feature D lands.
import { adminApiTokensApi } from '@tie/shared';
import { stubRoutes } from '../lib/stub';

export default stubRoutes({ adminApiTokensApi });

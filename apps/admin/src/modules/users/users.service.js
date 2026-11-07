/**
 * Admin user service (LLD-05 §6.3, read side only in this story).
 * User creation / role change are not in this story's scope (see report).
 *
 * @param {object} store - Store with listUsers.
 * @returns {object} User operations.
 */
function createUsersService(store) {
  return {
    async listUsers({ role, page, limit }) {
      return store.listUsers({ role, page, limit });
    }
  };
}

module.exports = { createUsersService };

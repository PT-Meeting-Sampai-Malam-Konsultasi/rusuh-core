/**
 * Admin user use case (LLD-05 §6.3, read side only in this story).
 * User creation / role change are not in this story's scope (see report).
 *
 * @param {import('@/domain/ports/store.port').AdminStore} store - Store with listUsers.
 * @returns {object} User operations.
 */
function createUsersUseCase(store) {
  return {
    async listUsers({ role, page, limit }) {
      return store.listUsers({ role, page, limit });
    }
  };
}

module.exports = { createUsersUseCase };

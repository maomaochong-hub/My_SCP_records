/* 角色态：所有者 / 访客。仅做 UX，真正的拦截在服务端 */

export function applyRole(session) {
  const isOwner = !!(session && session.authenticated);
  document.body.classList.toggle('is-owner', isOwner);
  document.body.dataset.role = isOwner ? 'owner' : 'guest';

  const save = document.getElementById('saveState');
  const saveTxt = document.getElementById('saveText');
  if (save && saveTxt && !isOwner) {
    save.dataset.state = 'readonly';
    saveTxt.textContent = '只读浏览';
  }
  return isOwner;
}

/** 页面渲染完成后调用：访客一律锁定可编辑区域 */
export function lockEditing() {
  document.querySelectorAll('[contenteditable="true"]').forEach((el) => {
    el.setAttribute('contenteditable', 'false');
    el.setAttribute('tabindex', '-1');
  });
  document.querySelectorAll('[data-owner-only]').forEach((el) => {
    el.setAttribute('hidden', 'hidden');
  });
}

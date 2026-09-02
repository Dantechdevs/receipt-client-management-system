document.addEventListener('DOMContentLoaded', function () {
  var toggle = document.getElementById('navToggle');
  var panel = document.getElementById('mobileNavPanel');
  if (toggle && panel) {
    toggle.addEventListener('click', function () {
      toggle.classList.toggle('open');
      panel.classList.toggle('open');
    });
  }
});

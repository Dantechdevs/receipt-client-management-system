with open('public/css/style.css') as f:
    lines = f.readlines()
new_block = '''.login-shell {
  min-height: 100vh; display: flex; align-items: center; justify-content: center;
  position: relative; overflow: hidden;
}
.login-bg-collage {
  position: absolute; top: 0; right: 0; bottom: 0; left: 0; display: flex; z-index: 0;
}
.login-bg-collage > div {
  flex: 1; background-size: cover; background-position: center;
}
.login-bg-overlay {
  position: absolute; top: 0; right: 0; bottom: 0; left: 0; z-index: 1;
  background: linear-gradient(135deg, rgba(15,42,92,0.88) 0%, rgba(30,58,109,0.82) 45%, rgba(180,95,30,0.85) 100%);
}
.login-box { position: relative; z-index: 2; background: #fff; padding: 36px; border-radius: 10px; width: 360px; box-shadow: 0 20px 50px rgba(15,42,92,0.35); }
.login-box h1 { font-size: 20px; margin: 0 0 4px; color: var(--navy); }
.login-box p.sub { color: var(--slate-light); font-size: 13px; margin: 0 0 20px; }
'''
lines[173:190] = [new_block]
with open('public/css/style.css', 'w') as f:
    f.writelines(lines)
print('CSS updated successfully')

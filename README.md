# 3DV

Standalone static app generated from `F:\CODE-4\3D_Viewer\viewer`.

## Tabs

- 3D Viewer (`viewer3d`)
- 3D RVM Viewer (`viewer3d-rvm`)
- 3D Json Viewer (`viewer3d-json`)

## Run locally

Serve this folder as a static web root:

```powershell
python -m http.server 8080
```

Then open `http://localhost:8080/`.

## Validate standalone shell

Run the static validation guard before publishing or merging shell changes:

```powershell
npm test
```

The guard checks that local static references exist, GitHub Pages deployment keeps `.nojekyll`, the app has only the expected standalone tabs, and `index.html` has a single external module startup owner.

## Validate evidence UI summary

Run the focused evidence summary test when changing the 3D Json Viewer evidence path:

```powershell
npm run test:evidence-ui
```

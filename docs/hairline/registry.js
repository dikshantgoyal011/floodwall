// Hairline figures register independently; the React host supplies their canvas.
window.floodwallFigures = Object.create(null);
window.hairline = (figure) => { window.floodwallFigures[figure.name] = figure; };

const express = require('express');
const axios = require('axios');
const { createClient } = require('@supabase/supabase-js');
const app = express();
const cors = require('cors');
const bodyParser = require('body-parser');
const { PDFDocument, rgb, StandardFonts } = require('pdf-lib');
const fs = require('fs');
const path = require('path');
const fontkit = require('@pdf-lib/fontkit');
app.use(cors({ origin: 'http://localhost:5173' }));
app.use('/certificates', express.static(path.join(__dirname, 'certificates')));
app.use(express.json());

const CLIENT_ID = 'a3d7dfb8abd98a50020df37f5cb7939f';
const CLIENT_SECRET = '907b33907c20c8c992739f0ddce7fee76abf77a3f02b33d67412b21fbf942991';

const supabase = createClient(
	'https://bpqziwzjcgxkmzsoiids.supabase.co',
	'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImJwcXppd3pqY2d4a216c29paWRzIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NDY1MzIwODQsImV4cCI6MjA2MjEwODA4NH0.OsNRXRBdwq0tJRh_P8friRjLo5dGiBHblFdo5slB1Q0',
);

app.use(express.json());
function enc(name) {
	const timestamp = new Date().getTime();
	const rawKey = `${name}-${timestamp}`;
	return Buffer.from(rawKey).toString('base64');
}

app.post('/api/submit', async (req, res) => {
	const { id, lang, code } = req.body;

	if (!lang || !code || !id) {
		return res.status(400).json({ error: 'Invalid input format' });
	}

	try {
		const { data: question, error: questionError } = await supabase
			.from('questions')
			.select('id, testcase')
			.eq('id', id)
			.single();
		console.log(question);
		if (questionError) {
			console.error('Error fetching question:', questionError.message);
			return res.status(500).json({ error: 'Failed to fetch question' });
		}

		if (!question) {
			return res.status(400).json({ error: 'No test cases found for the provided question ID' });
		}

		const jdoodlePayload = {
			clientId: CLIENT_ID,
			clientSecret: CLIENT_SECRET,
			script: code,
			language: lang,
			versionIndex: '0',
			stdin: '',
		};

		const outputs = [];

		for (const testcase of question.testcase) {
			jdoodlePayload.stdin = testcase.input;

			const result = await axios.post('https://api.jdoodle.com/v1/execute', jdoodlePayload);

			const passed = result.data.output.trim() === testcase.expectedOutput.trim();

			outputs.push({
				testCase: testcase.input,
				output: result.data.output,
				expectedOutput: testcase.expectedOutput,
				status: passed ? 'Passed' : 'Failed',
			});
		}

		return res.json({
			success: true,
			testcases: outputs,
		});
	} catch (error) {
		console.error('Error running code:', error);
		return res.status(500).json({ error: 'Failed to execute code' });
	}
});

const PORT = process.env.PORT || 3000;
app.get('/api/question/:id', async (req, res) => {
	const { id } = req.params;

	try {
		const { data, error } = await supabase.from('questions').select('*').eq('id', id).single();

		if (error) {
			console.error('Error fetching question:', error);
			return res.status(500).json({ error: 'Failed to fetch question' });
		}

		if (!data) {
			return res.status(404).json({ error: 'Question not found' });
		}

		res.json(data);
	} catch (error) {
		console.error('Error processing request:', error);
		res.status(500).json({ error: 'Internal server error' });
	}
});

app.get('/api/questions', async (req, res) => {
	const { subject } = req.query;

	try {
		let query = supabase.from('questions').select('id, title');
		let data;

		if (subject) {
			query = query.eq('type', subject);
		}

		const { data: questions, error } = await query;

		if (error) {
			throw error;
		}

		res.status(200).json(questions);
	} catch (error) {
		console.error('Error fetching questions:', error);
		res.status(500).json({ error: 'Failed to fetch questions' });
	}
});
app.post('/api/question/submit', async (req, res) => {
	const { id, title, description, testcase, type } = req.body;

	try {
		const { data, error } = await supabase.from('questions').insert([
			{
				id,
				title,
				description,
				testcase,
				type,
			},
		]);

		if (error) {
			throw error;
		}

		res.status(200).json({ message: 'Question submitted successfully', data });
	} catch (error) {
		console.error('Error inserting data:', error);
		res.status(500).json({ error: 'Failed to submit question', details: error.message });
	}
});

app.post('/api/login', async (req, res) => {
	try {
		const { email, password } = req.body;
		if (!email || !password) {
			return res.status(400).json({ error: 'Email and password are required' });
		}

		let { data: users, error } = await supabase.from('people').select('*').eq('email', email);

		if (error) throw error;

		if (!users || users.length === 0) {
			return res.status(401).json({ error: 'Invalid credentials' });
		}
		const user = users[0];
		console.log(user, email, password);

		const passwordMatch = password === user.password;

		if (!passwordMatch) {
			return res.status(401).json({ error: 'Invalid credentials' });
		}

		res.json({
			message: 'Login successful',
			user: {
				id: user.id,
				email: user.email,
				name: user.name,
			},
		});
	} catch (error) {
		console.error('Login error:', error);
		res.status(500).json({ error: 'Internal server error' });
	}
});
app.post('/api/generate_certificate', async (req, res) => {
	const { name, course_name, duration } = req.body;
	let instructor = 'Krypton';
	if (!name) {
		return res.status(400).json({ error: 'Name is required' });
	}

	const key = enc(name);
	const today = new Date().toLocaleDateString();

	try {
		// Load the sample PDF
		const pdfPath = path.join(__dirname, 'sample.pdf');
		const existingPdfBytes = fs.readFileSync(pdfPath);

		// Load PDF document and embed font
		const pdfDoc = await PDFDocument.load(existingPdfBytes);

		pdfDoc.registerFontkit(fontkit);
		const nameFontBytes = fs.readFileSync(path.join(__dirname, 'GoodVibrations Script.ttf'));
		const nameFont = await pdfDoc.embedFont(nameFontBytes);

		const fontBytes = fs.readFileSync(path.join(__dirname, 'Madera Regular.otf'));
		const font = await pdfDoc.embedFont(fontBytes);

		const boldFontBytes = fs.readFileSync(path.join(__dirname, 'Madera W01 Bold.otf'));
		const boldFont = await pdfDoc.embedFont(boldFontBytes);

		const pages = pdfDoc.getPages();
		const firstPage = pages[0];

		// Add name to the PDF
		let textWidth = nameFont.widthOfTextAtSize(name, 40);
		firstPage.drawText(name, {
			x: (600 - textWidth) / 2,
			y: 350,
			size: 40,
			font: nameFont,
			color: rgb(0, 0, 0),
		});

		//course name - Bro template text like "completed ...." adhu ku thaniya string vatchi merge panniralam
		let content = `Completed a structured ${course_name} online course (duration: ${duration}) through the Krypton E-Learning Platform.`;

		const fontSize = 12;
		const y = 300;
		const xStart = 75;

		function drawStyledText(x, y, styles) {
			let currentX = x;
			let currentY = y;
			let mid = 2;
			const lineHeight = 1.5 * fontSize;
			for (const style of styles) {
				firstPage.drawText(style.text, {
					x: currentX,
					y: currentY,
					font: style.font,
					size: style.size || fontSize,
					color: style.color || rgb(0, 0, 0),
				});

				currentX += style.font.widthOfTextAtSize(style.text, style.size || fontSize);
				if (currentX >= 500) {
					currentX = x;
					mid++;
					currentY -= lineHeight;
					console.log('yeet');
				}
			}
		}

		let wordObjects = [
			[
				{ text: 'Completed ', font: font },
				{ text: 'a ', font: font },
				{ text: 'structured ', font: font },
				{ text: ' ', font: font },
			],
			[
				{ text: ' ', font: font },
				{ text: 'online ', font: font },
				{ text: 'course ', font: font },
				{ text: '(duration: ', font: font },
				{ text: ' ', font: font },
			],
			[
				{ text: ') ', font: font },
				{ text: 'through ', font: font },
				{ text: 'the ', font: font },
				{ text: 'collaborative ', font: font },
				{ text: "'Krypton ", font: font },
				{ text: 'E-Learning ', font: font },
				{ text: "Platform' ", font: font },
				{ text: 'program ', font: font },
				{ text: 'delivered ', font: font },
				{ text: 'by ', font: font },
				{ text: ' ', font: font },
			],
			[{ text: '.', font: font }],
		];

		let keys = [course_name.split(' '), duration.split(' '), instructor.split(' ')];

		let keyObjects = keys.map((innerArray) =>
			innerArray.map((key) => ({
				text: key + ' ',
				font: boldFont,
			})),
		);

		console.log(wordObjects, keyObjects);
		drawStyledText(xStart, y, [
			...wordObjects[0], //Completed a structured
			...keyObjects[0],
			...wordObjects[1], // online course (duration:
			...keyObjects[1],
			...wordObjects[2], // through the collaborative 'STEM for Society' program, delivered by
			...keyObjects[2],
		]);

		// Add date to the PDF
		/* firstPage.drawText(today, {
			x: 150,
			y: 95,
			size: 12,
			font,
			color: rgb(0, 0, 0),
		}) */

		// Add key to the PDF
		firstPage.drawText(key, {
			x: 120,
			y: 170,
			size: 6,
			font,
			color: rgb(0, 0, 0),
		});

		//sign - 300,170

		// Save the updated PDF to the server
		const outputPath = path.join(__dirname, `certificates/${name}_certificate.pdf`);
		fs.mkdirSync(path.dirname(outputPath), { recursive: true });
		fs.writeFileSync(outputPath, await pdfDoc.save());

		const publicPath = `certificates/${name}_certificate.pdf`;

		res.status(200).json({
			message: 'Certificate generated successfully',
			path: publicPath,
		});
	} catch (error) {
		console.error('Error generating certificate:', error);
		res.status(500).json({ error: 'Failed to generate certificate' });
	}
});

app.listen(PORT, () => {
	console.log(`Server is running on port ${PORT}`);
});
